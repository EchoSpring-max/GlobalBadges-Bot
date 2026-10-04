import {
    Client,
    Events,
    GatewayIntentBits,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} from "discord.js";

import { downloadBadgeImage } from "./store.js";

const commands = [
    new SlashCommandBuilder()
        .setName("badge")
        .setDescription("Manage global profile badges")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
            .addUserOption(option => option.setName("user").setDescription("Badge owner").setRequired(true)))
].map(command => command.toJSON());

export async function registerCommands({ token, clientId, guildId }) {
    const rest = new REST({ version: "10" }).setToken(token);
    const route = guildId
        ? Routes.applicationGuildCommands(clientId, guildId)
        : Routes.applicationCommands(clientId);
    await rest.put(route, { body: commands });
    console.log(`Registered commands ${guildId ? `for guild ${guildId}` : "globally"}`);
}

export function createDiscordClient({ store }) {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once(Events.ClientReady, readyClient => {
        console.log(`Discord bot logged in as ${readyClient.user.tag}`);
    });

    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand() || interaction.commandName !== "badge") return;

        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: "You need the Manage Server permission to manage badges.", ephemeral: true });
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
