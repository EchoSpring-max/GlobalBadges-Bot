# GlobalBadges Bot

A self-hosted Discord badge manager and API for the GlobalBadges Vencord plugin.

## Discord commands

- `/badge add user name image` — assign a custom badge.
- `/badge remove user name` — remove a custom badge.
- `/badge list user` — list a user's custom badges.
- `/status` — show API health, stored user/badge counts, and process uptime.

Commands require the Discord **Manage Server** permission. The bot only requests the `Guilds` gateway intent and does not read messages.

## Railway deployment

1. Create a Discord application and bot at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy the application ID and reset/copy the bot token.
3. Deploy this GitHub repository as a Railway service.
4. Generate a public domain under **Settings → Networking**.
5. Add a Railway volume mounted at `/data` so badges survive deployments.
6. Set these service variables:

   - `DISCORD_TOKEN` — the bot token.
   - `DISCORD_CLIENT_ID` — the Discord application ID.
   - `DISCORD_GUILD_ID` — optional server ID for immediate command registration while testing.
   - `DATA_DIR=/data`

Railway supplies `PORT` and `RAILWAY_PUBLIC_DOMAIN`. Before a domain exists, the API derives its public URL from each request. The service automatically registers slash commands on startup. Guild commands appear immediately; global commands can take longer to propagate.

After deployment, visit the Railway domain. The JSON response includes an `inviteUrl` for installing the bot in a Discord server.

## API

- `GET /health`
- `GET /users/:discordUserId`
- `GET /badges/:filename`

Point the matching GlobalBadges plugin at the Railway service URL. User responses are compatible with the plugin's existing badge format.

## Local development

Copy `.env.example` to `.env`, supply the Discord variables, then run:

```sh
npm install
npm test
npm start
```
