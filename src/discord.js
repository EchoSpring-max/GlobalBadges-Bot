import {
    Client,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} from "discord.js";

import { downloadBadgeImage } from "./store.js";

const commands = [
    new SlashCommandBuilder()
        .setName("badge")
        .setDescription("Manage global profile badges")
        .addSubcommand(command => command
            .setName("add")
            .setDescription("Add a global badge to a Discord user")
            .addUserOption(option => option.setName("user").setDescription("User receiving the badge").setRequired(true))
            .addStringOption(option => option.setName("name").setDescription("Badge tooltip/name").setMaxLength(80).setRequired(true))
            .addAttachmentOption(option => option.setName("image").setDescription("PNG, JPEG, GIF, or WebP up to 8 MB").setRequired(true)))
        .addSubcommand(command => command
            .setName("remove")
            .setDescription("Remove one of a user's global badges")
            .addUserOption(option => option.setName("user").setDescription("Badge owner").setRequired(true))
            .addStringOption(option => option.setName("name").setDescription("Exact badge name").setMaxLength(80).setRequired(true)))
        .addSubcommand(command => command
            .setName("list")
            .setDescription("List a user's global badges")
            .addUserOption(option => option.setName("user").setDescription("Badge owner").setRequired(true))),
    new SlashCommandBuilder()
        .setName("status")
        .setDescription("Show the GlobalBadges bot and API status"),
    new SlashCommandBuilder()
        .setName("admin")
        .setDescription("Manage users allowed to operate GlobalBadges")
        .addSubcommand(command => command
            .setName("add")
            .setDescription("Allow a user to manage badges")
            .addUserOption(option => option.setName("user").setDescription("New GlobalBadges admin").setRequired(true)))
        .addSubcommand(command => command
            .setName("remove")
            .setDescription("Revoke a user's badge-management access")
            .addUserOption(option => option.setName("user").setDescription("GlobalBadges admin to remove").setRequired(true)))
        .addSubcommand(command => command
            .setName("list")
            .setDescription("List GlobalBadges admins"))
].map(command => command.toJSON());

export async function registerCommands({ token, clientId, guildId }) {
    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log(`Registered commands ${guildId ? `for guild ${guildId}` : "globally"}`);
}

export function createDiscordClient({ store, publicBaseUrl, ownerUserId }) {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once(Events.ClientReady, readyClient => {
        console.log(`Discord bot logged in as ${readyClient.user.tag}`);
    });

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const isOwner = interaction.user.id === ownerUserId;
        const isAuthorized = isOwner || store.isAdmin(interaction.user.id);

        if (interaction.commandName === "admin") {
            if (!isOwner) {
                await interaction.reply({ content: "Only the bot owner can manage GlobalBadges admins.", ephemeral: true });
                return;
            }

            const action = interaction.options.getSubcommand();
            if (action === "list") {
                const admins = store.listAdmins();
                await interaction.reply({
                    content: admins.length ? `GlobalBadges admins:\n${admins.map(id => `• <@${id}>`).join("\n")}` : "No delegated admins.",
                    ephemeral: true
                });
                return;
            }

            const user = interaction.options.getUser("user", true);
            if (user.id === ownerUserId) {
                await interaction.reply({ content: "The owner always has access and does not need an admin entry.", ephemeral: true });
                return;
            }

            const changed = action === "add" ? await store.addAdmin(user.id) : await store.removeAdmin(user.id);
            await interaction.reply({
                content: changed
                    ? `${action === "add" ? "Granted" : "Revoked"} GlobalBadges admin access ${action === "add" ? "to" : "for"} ${user}.`
                    : `${user} ${action === "add" ? "already has" : "does not have"} GlobalBadges admin access.`,
                ephemeral: true
            });
            return;
        }

        if (!isAuthorized) {
            await interaction.reply({ content: "You are not authorized to use this bot.", ephemeral: true });
            return;
        }

        if (interaction.commandName === "status") {
            const stats = store.stats();
            const uptime = Math.floor(process.uptime());
            const days = Math.floor(uptime / 86_400);
            const hours = Math.floor((uptime % 86_400) / 3_600);
            const minutes = Math.floor((uptime % 3_600) / 60);
            await interaction.reply({
                content: [
                    "**GlobalBadges is online**",
                    `Users: **${stats.users}**`,
                    `Badges: **${stats.badges}**`,
                    `Uptime: **${days}d ${hours}h ${minutes}m**`,
                    `API: ${publicBaseUrl ?? "Railway domain pending"}`
                ].join("\n"),
                ephemeral: true
            });
            return;
        }

        if (interaction.commandName !== "badge") return;

        if (!interaction.inGuild()) {
            await interaction.reply({ content: "Badge commands must be used in a server.", ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        const action = interaction.options.getSubcommand();
        const user = interaction.options.getUser("user", true);

        try {
            if (action === "add") {
                const name = interaction.options.getString("name", true);
                const attachment = interaction.options.getAttachment("image", true);
                const image = await downloadBadgeImage(attachment.url);
                await store.add(user.id, name, image);
                await interaction.editReply(`Added **${name.trim()}** to ${user}. It is available to GlobalBadges immediately.`);
                return;
            }

            if (action === "remove") {
                const name = interaction.options.getString("name", true);
                const removed = await store.remove(user.id, name);
                await interaction.editReply(removed
                    ? `Removed **${removed.name}** from ${user}.`
                    : `${user} does not have a badge named **${name.trim()}**.`);
                return;
            }

            const badges = store.list(user.id);
            await interaction.editReply(badges.length
                ? `${user}'s badges:\n${badges.map(badge => `• ${badge.name}`).join("\n")}`
                : `${user} has no custom badges.`);
        } catch (error) {
            console.error("Badge command failed", error);
            await interaction.editReply(`Could not ${action} the badge: ${error.message}`);
        }
    });

    return client;
}
