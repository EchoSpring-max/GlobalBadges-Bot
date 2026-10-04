import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createHttpApp, resolvePublicBaseUrl } from "../src/http.js";
import { BadgeStore } from "../src/store.js";

test("serves plugin-compatible user badge data", async context => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "globalbadges-http-"));
    const store = new BadgeStore(directory);
    await store.initialize();
    await store.add("123456789012345678", "Founder", { contentType: "image/png", bytes: Buffer.from("png") });

    const server = createHttpApp({ store, publicBaseUrl: "https://badges.example", clientId: "123" }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    context.after(() => server.close());

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/users/123456789012345678`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.BadgeVault[0].name, "Founder");
    assert.match(body.BadgeVault[0].badge, /^https:\/\/badges\.example\/badges\/.+\.png$/);
});

test("merges preserved legacy badges with bot-managed badges", async context => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "globalbadges-http-"));
    const store = new BadgeStore(directory);
    await store.initialize();
    await store.add("123456789012345678", "Founder", { contentType: "image/png", bytes: Buffer.from("png") });
    const legacySource = {
        async get() {
            return { Replugged: ["early"], BadgeVault: [{ name: "Legacy", badge: "https://example.com/legacy.png" }] };
        }
    };

    const server = createHttpApp({ store, publicBaseUrl: "https://badges.example", clientId: "123", legacySource }).listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    context.after(() => server.close());

    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/users/123456789012345678`);
    const body = await response.json();
    assert.deepEqual(body.Replugged, ["early"]);
    assert.equal(body.BadgeVault.length, 2);
    assert.equal(body.BadgeVault[0].name, "Legacy");
    assert.equal(body.BadgeVault[1].name, "Founder");
});

test("uses Railway's generated domain", () => {
    assert.equal(resolvePublicBaseUrl({ RAILWAY_PUBLIC_DOMAIN: "badges.up.railway.app" }), "https://badges.up.railway.app");
    assert.equal(resolvePublicBaseUrl({}), null);
});
