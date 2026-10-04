import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_CONTENT_TYPES = new Map([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/gif", ".gif"],
    ["image/webp", ".webp"]
]);

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class BadgeStore {
    constructor(dataDirectory) {
        this.dataDirectory = dataDirectory;
        this.imageDirectory = path.join(dataDirectory, "images");
        this.databasePath = path.join(dataDirectory, "badges.json");
        this.data = { users: {} };
        this.writeQueue = Promise.resolve();
    }

    async initialize() {
        await mkdir(this.imageDirectory, { recursive: true });
        try {
            const stored = JSON.parse(await readFile(this.databasePath, "utf8"));
            if (!stored || typeof stored !== "object" || !stored.users || typeof stored.users !== "object") {
                throw new Error("badges.json has an invalid structure");
            }
            this.data = stored;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            await this.persist();
        }
    }

    list(userId) {
        return [...(this.data.users[userId] ?? [])];
    }

    stats() {
        const badgeLists = Object.values(this.data.users);
        return {
            users: badgeLists.length,
            badges: badgeLists.reduce((total, badges) => total + badges.length, 0)
        };
    }

    async add(userId, name, image) {
        const normalizedName = name.trim();
        if (!normalizedName || normalizedName.length > 80) {
            throw new Error("Badge names must be between 1 and 80 characters.");
        }

        const extension = ALLOWED_CONTENT_TYPES.get(image.contentType?.split(";")[0].toLowerCase());
        if (!extension) throw new Error("Badge images must be PNG, JPEG, GIF, or WebP.");
        if (!image.bytes.length || image.bytes.length > MAX_IMAGE_BYTES) {
            throw new Error("Badge images must be between 1 byte and 8 MB.");
        }

        const existing = this.list(userId);
        if (existing.some(badge => badge.name.toLowerCase() === normalizedName.toLowerCase())) {
            throw new Error(`A badge named “${normalizedName}” already exists for that user.`);
        }

        const filename = `${randomUUID()}${extension}`;
        await writeFile(path.join(this.imageDirectory, filename), image.bytes, { flag: "wx" });
        this.data.users[userId] = [...existing, { name: normalizedName, filename }];

        try {
            await this.persist();
        } catch (error) {
            await unlink(path.join(this.imageDirectory, filename)).catch(() => {});
            this.data.users[userId] = existing;
            throw error;
        }

        return { name: normalizedName, filename };
    }

    async remove(userId, name) {
        const existing = this.list(userId);
        const index = existing.findIndex(badge => badge.name.toLowerCase() === name.trim().toLowerCase());
        if (index === -1) return null;

        const [removed] = existing.splice(index, 1);
        if (existing.length) this.data.users[userId] = existing;
        else delete this.data.users[userId];
        await this.persist();
        await unlink(path.join(this.imageDirectory, removed.filename)).catch(error => {
            if (error.code !== "ENOENT") console.error("Failed to remove badge image", error);
        });
        return removed;
    }

    async persist() {
        const operation = this.writeQueue.then(async () => {
            const temporaryPath = `${this.databasePath}.${process.pid}.tmp`;
            await writeFile(temporaryPath, `${JSON.stringify(this.data, null, 2)}\n`);
            await rename(temporaryPath, this.databasePath);
        });
        this.writeQueue = operation.catch(() => {});
        return operation;
    }
}

export async function downloadBadgeImage(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Discord returned HTTP ${response.status} for the image.`);

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new Error("Badge images cannot exceed 8 MB.");

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
        bytes,
        contentType: response.headers.get("content-type") ?? ""
    };
}
