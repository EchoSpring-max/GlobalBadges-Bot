import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    EmbedBuilder,
    Events,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} from "discord.js";

import { downloadBadgeImage } from "./store.js";

const REVIEW_BUTTON_PREFIX = "badge-review";
const PENDING_COLOR = 0xfee75c;
const APPROVED_COLOR = 0x23a55a;
const DENIED_COLOR = 0xda373c;

const commands = [
    new SlashCommandBuilder()
        .setName("badge")
        .setDescription("Request or manage global profile badges")
        .addSubcommand(command => command
            .setName("request")
            .setDescription("Submit a badge for moderator approval")
            .addStringOption(option => option.setName("name").setDescription("Badge tooltip/name").setMaxLength(80).setRequired(true))
            .addAttachmentOption(option => option.setName("image").setDescription("PNG, JPEG, GIF, or WebP up to 8 MB").setRequired(true)))
        .addSubcommand(command => command
            .setName("add")
            .setDescription("Immediately add a badge (GlobalBadges admins only)")
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
        .setName("review-channel")
        .setDescription("Configure the badge request review channel")
        .addSubcommand(command => command
            .setName("set")
            .setDescription("Send new badge requests to a channel")
            .addChannelOption(option => option
                .setName("channel")
                .setDescription("Channel where badge requests will be reviewed")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)))
        .addSubcommand(command => command
            .setName("status")
            .setDescription("Show the configured badge review channel"))
        .addSubcommand(command => command
            .setName("clear")
            .setDescription("Disable public badge requests in this server")),
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

function reviewButtons(requestId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${REVIEW_BUTTON_PREFIX}:approve:${requestId}`)
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`${REVIEW_BUTTON_PREFIX}:deny:${requestId}`)
            .setLabel("Deny")
            .setStyle(ButtonStyle.Danger)
    );
}

function reviewEmbed(request, { status = "Pending review", reviewer = null } = {}) {
    const approved = status === "Approved";
    const denied = status === "Denied";
    return new EmbedBuilder()
        .setColor(approved ? APPROVED_COLOR : denied ? DENIED_COLOR : PENDING_COLOR)
        .setAuthor({
            name: request.requesterName,
            ...(request.requesterAvatarUrl ? { iconURL: request.requesterAvatarUrl } : {})
        })
        .setTitle(`${request.requesterName}'s Badge Request`)
        .addFields(
            { name: "Badge Name", value: request.name, inline: true },
            { name: "Requester", value: `<@${request.requesterId}>`, inline: true },
            { name: "Original URL", value: `[Open image](${request.sourceUrl})` }
        )
        .setImage(`attachment://${request.filename}`)
        .setFooter({ text: reviewer ? `${status} by ${reviewer}` : status })
        .setTimestamp(reviewer ? new Date() : new Date(request.createdAt));
}

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
        const isOwner = interaction.user.id === ownerUserId;
        const isAuthorized = isOwner || store.isAdmin(interaction.user.id);

        if (interaction.isButton() && interaction.customId.startsWith(`${REVIEW_BUTTON_PREFIX}:`)) {
            if (!isAuthorized) {
                await interaction.reply({ content: "Only GlobalBadges admins can review badge requests.", ephemeral: true });
                return;
            }

            const [, decision, requestId] = interaction.customId.split(":");
            const request = store.getRequest(requestId);
            if (!request) {
                await interaction.reply({ content: "This badge request has already been reviewed or no longer exists.", ephemeral: true });
                return;
            }
            if (request.guildId !== interaction.guildId) {
                await interaction.reply({ content: "This request belongs to another server.", ephemeral: true });
                return;
            }

            await interaction.deferUpdate();
            try {
                const approved = decision === "approve";
                const reviewed = approved
                    ? await store.approveRequest(requestId)
                    : await store.denyRequest(requestId);
                if (!reviewed) {
                    await interaction.followUp({ content: "This request was already reviewed.", ephemeral: true });
                    return;
                }

                const status = approved ? "Approved" : "Denied";
                await interaction.editReply({
                    embeds: [reviewEmbed(reviewed, { status, reviewer: interaction.user.tag })],
                    components: []
                });
                await interaction.followUp({
                    content: `${status} **${reviewed.name}** for <@${reviewed.requesterId}>.`,
                    ephemeral: true
                });
                const requester = await client.users.fetch(reviewed.requesterId).catch(() => null);
                await requester?.send(`Your GlobalBadges request **${reviewed.name}** was **${status.toLowerCase()}** in **${interaction.guild?.name ?? "a server"}**.`).catch(() => {});
            } catch (error) {
                console.error("Badge review failed", error);
                await interaction.followUp({ content: `Could not review this badge: ${error.message}`, ephemeral: true });
            }
            return;
        }

        if (!interaction.isChatInputCommand()) return;

        if (interaction.commandName === "badge" && interaction.options.getSubcommand() === "request") {
            if (!interaction.inGuild()) {
                await interaction.reply({ content: "Badge requests must be submitted in a server.", ephemeral: true });
                return;
            }

            const reviewChannelId = store.getReviewChannel(interaction.guildId);
            if (!reviewChannelId) {
                await interaction.reply({ content: "This server has not configured a badge review channel yet.", ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });
            const name = interaction.options.getString("name", true);
            const attachment = interaction.options.getAttachment("image", true);
            try {
                const reviewChannel = await client.channels.fetch(reviewChannelId);
                if (!reviewChannel?.isTextBased()) throw new Error("The configured review channel is unavailable.");

                const image = await downloadBadgeImage(attachment.url);
                const request = await store.createRequest({
                    guildId: interaction.guildId,
                    requesterId: interaction.user.id,
                    requesterName: interaction.user.globalName ?? interaction.user.username,
                    requesterAvatarUrl: interaction.user.displayAvatarURL(),
                    sourceUrl: attachment.url,
                    name,
                    image
                });

                try {
                    await reviewChannel.send({
                        embeds: [reviewEmbed(request)],
                        components: [reviewButtons(request.id)],
                        files: [{ attachment: image.bytes, name: request.filename }]
                    });
                } catch (error) {
                    await store.denyRequest(request.id);
                    throw error;
                }

                await interaction.editReply(`Submitted **${request.name}** for review in <#${reviewChannelId}>.`);
            } catch (error) {
                console.error("Badge request failed", error);
                await interaction.editReply(`Could not submit the badge request: ${error.message}`);
            }
            return;
        }

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
            await interaction.reply({ content: "You are not authorized to use this bot. Use `/badge request` to submit a badge for review.", ephemeral: true });
            return;
        }

        if (interaction.commandName === "review-channel") {
            if (!interaction.inGuild()) {
                await interaction.reply({ content: "Review channels can only be configured in a server.", ephemeral: true });
                return;
            }

            const action = interaction.options.getSubcommand();
            if (action === "set") {
                const channel = interaction.options.getChannel("channel", true);
                await store.setReviewChannel(interaction.guildId, channel.id);
                await interaction.reply({ content: `Badge requests will now be sent to ${channel}.`, ephemeral: true });
                return;
            }
            if (action === "clear") {
                const changed = await store.clearReviewChannel(interaction.guildId);
                await interaction.reply({ content: changed ? "Badge requests are now disabled in this server." : "No review channel was configured.", ephemeral: true });
                return;
            }

            const channelId = store.getReviewChannel(interaction.guildId);
            await interaction.reply({
                content: channelId ? `The badge review channel is <#${channelId}>.` : "No badge review channel is configured.",
                ephemeral: true
            });
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
                    `Pending requests: **${stats.pendingRequests}**`,
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
