import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BadgeStore } from "../src/store.js";

async function createStore() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "globalbadges-"));
    const store = new BadgeStore(directory);
    await store.initialize();
    return { directory, store };
}

test("adds, persists, reloads, and removes a badge", async () => {
    const { directory, store } = await createStore();
    const added = await store.add("123456789012345678", "Founder", {
        contentType: "image/png",
        bytes: Buffer.from("png")
    });

    assert.equal(store.list("123456789012345678")[0].name, "Founder");
    assert.match(added.filename, /^[0-9a-f-]+\.png$/);

    const reloaded = new BadgeStore(directory);
    await reloaded.initialize();
    assert.deepEqual(reloaded.list("123456789012345678"), [added]);

    assert.deepEqual(await reloaded.remove("123456789012345678", "founder"), added);
    assert.deepEqual(reloaded.list("123456789012345678"), []);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "badges.json"), "utf8")), { users: {} });
});

test("rejects unsafe or duplicate badge input", async () => {
    const { store } = await createStore();
    await assert.rejects(() => store.add("123", "Badge", { contentType: "text/plain", bytes: Buffer.from("x") }), /must be PNG/);
    await store.add("123", "Badge", { contentType: "image/png", bytes: Buffer.from("x") });
    await assert.rejects(() => store.add("123", "badge", { contentType: "image/png", bytes: Buffer.from("x") }), /already exists/);
});
