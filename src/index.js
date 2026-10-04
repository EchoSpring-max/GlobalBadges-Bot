import path from "node:path";

import { createDiscordClient, registerCommands } from "./discord.js";
import { createHttpApp, resolvePublicBaseUrl } from "./http.js";
import { BadgeStore } from "./store.js";

const requiredVariables = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID"];
for (const variable of requiredVariables) {
    if (!process.env[variable]) throw new Error(`Missing required environment variable: ${variable}`);
}

const port = Number(process.env.PORT || 3000);
const ownerUserId = process.env.OWNER_USER_ID || "506499260351774740";
if (!/^\d{17,20}$/.test(ownerUserId)) throw new Error("OWNER_USER_ID must be a Discord user ID.");
const dataDirectory = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || "./data");
const publicBaseUrl = resolvePublicBaseUrl(process.env);
const store = new BadgeStore(dataDirectory);
await store.initialize();

await registerCommands({
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID
});

const discordClient = createDiscordClient({ store, publicBaseUrl, ownerUserId });
await discordClient.login(process.env.DISCORD_TOKEN);

const app = createHttpApp({ store, publicBaseUrl, clientId: process.env.DISCORD_CLIENT_ID });
const server = app.listen(port, "0.0.0.0", () => {
    console.log(`GlobalBadges API listening on port ${port} at ${publicBaseUrl}`);
});

async function shutdown(signal) {
    console.log(`Received ${signal}; shutting down`);
    discordClient.destroy();
    server.close(error => process.exit(error ? 1 : 0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
