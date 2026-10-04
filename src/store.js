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
        this.pendingImageDirectory = path.join(dataDirectory, "pending-images");
        this.databasePath = path.join(dataDirectory, "badges.json");
        this.data = { users: {}, admins: [], reviewChannels: {}, requests: {} };
        this.writeQueue = Promise.resolve();
        this.reviewQueue = Promise.resolve();
    }

    async initialize() {
        await mkdir(this.imageDirectory, { recursive: true });
        await mkdir(this.pendingImageDirectory, { recursive: true });
        try {
            const stored = JSON.parse(await readFile(this.databasePath, "utf8"));
            if (!stored || typeof stored !== "object" || !stored.users || typeof stored.users !== "object") {
                throw new Error("badges.json has an invalid structure");
            }
            if (!Array.isArray(stored.admins)) stored.admins = [];
            if (!stored.reviewChannels || typeof stored.reviewChannels !== "object") stored.reviewChannels = {};
            if (!stored.requests || typeof stored.requests !== "object") stored.requests = {};
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
            badges: badgeLists.reduce((total, badges) => total + badges.length, 0),
            pendingRequests: Object.keys(this.data.requests).length
        };
    }

    getReviewChannel(guildId) {
        return this.data.reviewChannels[guildId] ?? null;
    }

    async setReviewChannel(guildId, channelId) {
        this.data.reviewChannels[guildId] = channelId;
        await this.persist();
    }

    async clearReviewChannel(guildId) {
        if (!this.getReviewChannel(guildId)) return false;
        delete this.data.reviewChannels[guildId];
        await this.persist();
        return true;
    }

    getRequest(requestId) {
        const request = this.data.requests[requestId];
        return request ? { ...request } : null;
    }

    async createRequest({ guildId, requesterId, requesterName, requesterAvatarUrl, sourceUrl, name, image }) {
        const normalizedName = this.validateBadge(name, image);
        if (this.list(requesterId).some(badge => badge.name.toLowerCase() === normalizedName.toLowerCase())) {
            throw new Error(`You already have a badge named “${normalizedName}”.`);
        }
        if (Object.values(this.data.requests).some(request =>
            request.requesterId === requesterId && request.name.toLowerCase() === normalizedName.toLowerCase()
        )) {
            throw new Error(`You already have a pending request named “${normalizedName}”.`);
        }

        const id = randomUUID();
        const extension = ALLOWED_CONTENT_TYPES.get(image.contentType.split(";")[0].toLowerCase());
        const filename = `${id}${extension}`;
        const request = {
            id,
            guildId,
            requesterId,
            requesterName,
            requesterAvatarUrl,
            sourceUrl,
            name: normalizedName,
            filename,
            contentType: image.contentType.split(";")[0].toLowerCase(),
            createdAt: new Date().toISOString()
        };
        const imagePath = path.join(this.pendingImageDirectory, filename);
        await writeFile(imagePath, image.bytes, { flag: "wx" });
        this.data.requests[id] = request;

        try {
            await this.persist();
        } catch (error) {
            delete this.data.requests[id];
            await unlink(imagePath).catch(() => {});
            throw error;
        }

        return { ...request };
    }

    async approveRequest(requestId) {
        return this.queueReviewOperation(async () => {
            const request = this.getRequest(requestId);
            if (!request) return null;

            const existing = this.list(request.requesterId);
            if (existing.some(badge => badge.name.toLowerCase() === request.name.toLowerCase())) {
                throw new Error(`A badge named “${request.name}” already exists for that user.`);
            }

            const pendingPath = path.join(this.pendingImageDirectory, request.filename);
            const approvedPath = path.join(this.imageDirectory, request.filename);
            await rename(pendingPath, approvedPath);
            this.data.users[request.requesterId] = [...existing, { name: request.name, filename: request.filename }];
            delete this.data.requests[requestId];

            try {
                await this.persist();
            } catch (error) {
                if (existing.length) this.data.users[request.requesterId] = existing;
                else delete this.data.users[request.requesterId];
                this.data.requests[requestId] = request;
                await rename(approvedPath, pendingPath).catch(() => {});
                throw error;
            }

            return request;
        });
    }

    async denyRequest(requestId) {
        return this.queueReviewOperation(async () => {
            const request = this.getRequest(requestId);
            if (!request) return null;
            delete this.data.requests[requestId];

            try {
                await this.persist();
            } catch (error) {
                this.data.requests[requestId] = request;
                throw error;
            }

            await unlink(path.join(this.pendingImageDirectory, request.filename)).catch(error => {
                if (error.code !== "ENOENT") console.error("Failed to remove pending badge image", error);
            });
            return request;
        });
    }

    listAdmins() {
        return [...this.data.admins];
    }

    isAdmin(userId) {
        return this.data.admins.includes(userId);
    }

    async addAdmin(userId) {
        if (this.isAdmin(userId)) return false;
        this.data.admins.push(userId);
        await this.persist();
        return true;
    }

    async removeAdmin(userId) {
        const index = this.data.admins.indexOf(userId);
        if (index === -1) return false;
        this.data.admins.splice(index, 1);
        await this.persist();
        return true;
    }

    async add(userId, name, image) {
        const normalizedName = this.validateBadge(name, image);
        const extension = ALLOWED_CONTENT_TYPES.get(image.contentType.split(";")[0].toLowerCase());

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

    validateBadge(name, image) {
        const normalizedName = name.trim();
        if (!normalizedName || normalizedName.length > 80) {
            throw new Error("Badge names must be between 1 and 80 characters.");
        }

        const contentType = image.contentType?.split(";")[0].toLowerCase();
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
            throw new Error("Badge images must be PNG, JPEG, GIF, or WebP.");
        }
        if (!image.bytes.length || image.bytes.length > MAX_IMAGE_BYTES) {
            throw new Error("Badge images must be between 1 byte and 8 MB.");
        }
        return normalizedName;
    }

    queueReviewOperation(operation) {
        const queued = this.reviewQueue.then(operation);
        this.reviewQueue = queued.catch(() => {});
        return queued;
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
