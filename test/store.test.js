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
    assert.deepEqual(store.stats(), { users: 1, badges: 1, pendingRequests: 0 });
    assert.match(added.filename, /^[0-9a-f-]+\.png$/);

    const reloaded = new BadgeStore(directory);
    await reloaded.initialize();
    assert.deepEqual(reloaded.list("123456789012345678"), [added]);

    assert.deepEqual(await reloaded.remove("123456789012345678", "founder"), added);
    assert.deepEqual(reloaded.list("123456789012345678"), []);
    assert.deepEqual(reloaded.stats(), { users: 0, badges: 0, pendingRequests: 0 });
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "badges.json"), "utf8")), {
        users: {},
        admins: [],
        reviewChannels: {},
        requests: {},
        botStatus: null
    });
});

test("persists review channels and approves or denies badge requests", async () => {
    const { directory, store } = await createStore();
    await store.setReviewChannel("guild-1", "channel-1");
    assert.equal(store.getReviewChannel("guild-1"), "channel-1");

    const request = await store.createRequest({
        guildId: "guild-1",
        requesterId: "123456789012345678",
        requesterName: "Requester",
        requesterAvatarUrl: "https://example.com/avatar.png",
        sourceUrl: "https://example.com/badge.png",
        name: "Founder",
        image: { contentType: "image/png", bytes: Buffer.from("png") }
    });
    assert.equal(store.stats().pendingRequests, 1);
    assert.equal(store.getRequest(request.id).name, "Founder");

    const reloaded = new BadgeStore(directory);
    await reloaded.initialize();
    assert.equal(reloaded.getReviewChannel("guild-1"), "channel-1");
    assert.equal((await reloaded.approveRequest(request.id)).name, "Founder");
    assert.equal(reloaded.getRequest(request.id), null);
    assert.equal(reloaded.list("123456789012345678")[0].name, "Founder");

    const denied = await reloaded.createRequest({
        guildId: "guild-1",
        requesterId: "987654321098765432",
        requesterName: "Other Requester",
        requesterAvatarUrl: "https://example.com/avatar.png",
        sourceUrl: "https://example.com/denied.png",
        name: "Denied badge",
        image: { contentType: "image/webp", bytes: Buffer.from("webp") }
    });
    assert.equal((await reloaded.denyRequest(denied.id)).name, "Denied badge");
    assert.equal(reloaded.getRequest(denied.id), null);
    assert.equal(await reloaded.clearReviewChannel("guild-1"), true);
    assert.equal(await reloaded.clearReviewChannel("guild-1"), false);
});

test("persists the configured bot presence", async () => {
    const { directory, store } = await createStore();
    assert.equal(store.getBotStatus(), null);
    await store.setBotStatus({ text: "Reviewing badges", activity: "watching", presence: "idle" });

    const reloaded = new BadgeStore(directory);
    await reloaded.initialize();
    assert.deepEqual(reloaded.getBotStatus(), {
        text: "Reviewing badges",
        activity: "watching",
        presence: "idle"
    });
    await reloaded.clearBotStatus();
    assert.equal(reloaded.getBotStatus(), null);
});

test("persists the delegated admin allowlist", async () => {
    const { directory, store } = await createStore();
    assert.equal(await store.addAdmin("987654321098765432"), true);
    assert.equal(await store.addAdmin("987654321098765432"), false);
    assert.equal(store.isAdmin("987654321098765432"), true);

    const reloaded = new BadgeStore(directory);
    await reloaded.initialize();
    assert.deepEqual(reloaded.listAdmins(), ["987654321098765432"]);
    assert.equal(await reloaded.removeAdmin("987654321098765432"), true);
    assert.equal(await reloaded.removeAdmin("987654321098765432"), false);
});

test("rejects unsafe or duplicate badge input", async () => {
    const { store } = await createStore();
    await assert.rejects(() => store.add("123", "Badge", { contentType: "text/plain", bytes: Buffer.from("x") }), /must be PNG/);
    await store.add("123", "Badge", { contentType: "image/png", bytes: Buffer.from("x") });
    await assert.rejects(() => store.add("123", "badge", { contentType: "image/png", bytes: Buffer.from("x") }), /already exists/);
});
