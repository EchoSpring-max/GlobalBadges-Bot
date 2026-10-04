# GlobalBadges Bot

A self-hosted Discord badge manager and API for the GlobalBadges Vencord plugin.

The API merges badges from the preserved legacy GlobalBadges dataset with badges managed by this bot, so existing badges remain visible during the migration.

## Discord commands

- `/badge request name image` — submit your own badge for moderator review.
- `/badge add user name image` — assign a custom badge.
- `/badge remove user name` — remove a custom badge.
- `/badge list user` — list a user's custom badges.
- `/review-channel set channel` — choose where badge request embeds are posted.
- `/review-channel status` — show the configured review channel.
- `/review-channel clear` — disable public requests in the server.
- `/status set text activity presence` — set the bot's Discord presence/activity.
- `/status show` — show the configured bot presence.
- `/status clear` — clear the bot's activity and return it to online.
- `/admin add user` — allow a user to operate the bot (owner only).
- `/admin remove user` — revoke a delegated admin (owner only).
- `/admin list` — list delegated admins (owner only).

`/badge request` is available to server members after an owner or delegated admin configures a review channel. Each request creates a persistent preview embed with **Approve** and **Deny** buttons. Only the owner and delegated admins can use those buttons or the remaining management commands. Delegated admins cannot manage the allowlist. The bot only requests the `Guilds` gateway intent and does not read messages.

## Railway deployment

1. Create a Discord application and bot at the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy the application ID and reset/copy the bot token.
3. Deploy this GitHub repository as a Railway service.
4. Generate a public domain under **Settings → Networking**.
5. Add a Railway volume mounted at `/data` so badges survive deployments.
6. Set these service variables:

   - `DISCORD_TOKEN` — the bot token.
   - `DISCORD_CLIENT_ID` — the Discord application ID.
   - `OWNER_USER_ID=506499260351774740` — the only user who can manage delegated admins.
   - `DISCORD_GUILD_ID` — optional server ID for immediate command registration while testing.
   - `DATA_DIR=/data`
   - `LEGACY_DATA_URL` — optional override for the preserved legacy badge dataset.

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
