import { Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder, TextChannel, type ChatInputCommandInteraction, type Message } from "discord.js";
import { env } from "./config.js";
import { SettingsCache } from "./settings.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});
const settings = new SettingsCache(() => client.guilds.cache.map(guild => guild.id));
const repeatedMessages = new Map<string, { content: string; count: number; firstAt: number }>();
const spamWindowMs = 10_000;
const spamThreshold = 6;
const botCreationDate = process.env.BOT_CREATION_DATE ?? "September 7, 2026";
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Check bot health"),
  new SlashCommandBuilder().setName("voteinfo").setDescription("Learn about the bot and its features"),
  new SlashCommandBuilder().setName("help").setDescription("Browse available commands and dashboard features")
].map(command => command.toJSON());

const configuredGifChannelIds = new Set((env.GIF_ONLY_CHANNEL_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean));

function isGifOnlyChannel(message: Message): boolean {
  return configuredGifChannelIds.has(message.channel.id) || ("name" in message.channel && message.channel.name === env.GIF_ONLY_CHANNEL_NAME);
}

function isGifUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.pathname.toLowerCase().endsWith(".gif") || host.includes("tenor.com") || host.includes("giphy.com");
  } catch {
    return false;
  }
}

function isAllowedGifMessage(message: Message): boolean {
  const attachments = [...message.attachments.values()];
  if (attachments.length > 0) return attachments.every(attachment => attachment.contentType === "image/gif" || isGifUrl(attachment.url) || Boolean(attachment.name?.toLowerCase().endsWith(".gif"))) && message.content.trim() === "";
  const content = message.content.trim();
  if (!content) return false;
  const parts = content.split(/\s+/);
  return parts.length > 0 && parts.every(isGifUrl);
}

async function warnAndDelete(message: Message, content: string): Promise<void> {
  if (!message.channel.isTextBased() || !("send" in message.channel)) return;
  const warning = await message.channel.send({ content }).catch(() => null);
  if (warning) setTimeout(() => { void warning.delete().catch(() => undefined); }, 3_000);
}

async function enforceGifOnlyChannel(message: Message): Promise<boolean> {
  if (!isGifOnlyChannel(message) || isAllowedGifMessage(message)) return false;
  if (!message.guild || !message.channel.isTextBased() || !("send" in message.channel)) return true;
  const permissions = message.guild.members.me?.permissionsIn(message.channel.id);
  if (permissions?.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => undefined);
    await warnAndDelete(message, `${message.author}, only GIFs are allowed in this channel.`);
  } else {
    console.warn(`GIF-only enforcement skipped in ${message.guild?.id}/${message.channel.id}: missing Manage Messages permission`);
  }
  return true;
}

async function enforceRepeatedMessageTimeout(message: Message): Promise<void> {
  if (!message.guild || !message.member || !message.content.trim() || !message.channel.isTextBased() || !("send" in message.channel)) return;
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const previous = repeatedMessages.get(key);
  const entry = previous && previous.firstAt + spamWindowMs > now && previous.content === message.content
    ? { content: previous.content, count: previous.count + 1, firstAt: previous.firstAt }
    : { content: message.content, count: 1, firstAt: now };
  repeatedMessages.set(key, entry);
  if (entry.count < spamThreshold) return;
  repeatedMessages.delete(key);
  const permissions = message.guild.members.me?.permissionsIn(message.channel.id);
  if (!permissions?.has(PermissionFlagsBits.ModerateMembers)) {
    console.warn(`Spam timeout skipped in ${message.guild.id}: missing Moderate Members permission`);
    return;
  }
  const timedOut = await message.member.timeout(10 * 60 * 1_000, "Repeated identical messages (6 in 10 seconds)").then(() => true).catch(error => {
    console.error(`Failed to timeout ${message.author.tag} in ${message.guild?.id}`, error);
    return false;
  });
  if (!timedOut) return;
  console.info(`Timed out ${message.author.tag} (${message.author.id}) in ${message.guild.id} for repeated-message spam`);
  await message.author.send(`You were timed out in **${message.guild.name}** for 10 minutes because you sent the same message 6 times within 10 seconds.`).catch(() => undefined);
}

const trackingCleanup = setInterval(() => {
  const cutoff = Date.now() - spamWindowMs;
  for (const [key, entry] of repeatedMessages) {
    if (entry.firstAt < cutoff) repeatedMessages.delete(key);
  }
}, spamWindowMs);
trackingCleanup.unref();

function voteInfoEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x7cf7c8)
    .setTitle("Zyrox Control Bot")
    .setDescription("A real-time community operations system for Discord communities.")
    .addFields(
      { name: "Bot Bio", value: `**Creator/Developer:** Syed\n**Creation Date:** ${botCreationDate}` },
      { name: "AI Community Support", value: "AI-powered auto-moderation and chatbot support for safer, faster community management." },
      { name: "Live Dashboard Sync", value: "Website configuration changes are delivered to the running bot in real time." },
      { name: "Dynamic Self-Roles", value: "Members can assign and remove configured roles through Discord buttons managed from the web dashboard." },
      { name: "Automated Status Roles", value: "Members are automatically assigned or removed from a role when their custom status matches the configured text, such as `.gg/community`." }
    )
    .setFooter({ text: "Zyrox Control Room" })
    .setTimestamp();
}

function helpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x7cf7c8)
    .setTitle("Zyrox Help Center")
    .setDescription("The central command registry for this server. Dashboard-controlled systems update live without a bot restart.")
    .addFields(
      { name: "General", value: "`/ping` Check bot latency and health\n`/voteinfo` View bot identity, capabilities, and system information\n`/help` Open this command registry" },
      { name: "Automation", value: "**Welcome and leave messages** Configure channel and message templates from the dashboard\n**AI support** Enable AI-powered chatbot support and assign its channel\n**Status roles** Match custom status text and automatically manage a role\n**Self roles** Publish interactive role buttons from the dashboard" },
      { name: "Moderation", value: "**Auto-Mod** Filter configured blacklisted words\n**Anti-Link** Remove unauthorized links\n**Anti-Spam** Detect bursts of messages and apply temporary timeouts" },
      { name: "Community Systems", value: "**Economy** Enable the server economy system\n**Leveling** Enable member progression and activity levels\nAll settings are managed per server in the web dashboard." }
    )
    .setFooter({ text: "Use the web dashboard to configure server systems" })
    .setTimestamp();
}

async function replyToCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName === "ping") {
    await interaction.reply({ content: `Pong: ${client.ws.ping}ms`, ephemeral: true });
    return;
  }
  if (interaction.commandName === "voteinfo") {
    await interaction.reply({ embeds: [voteInfoEmbed()] });
    return;
  }
  if (interaction.commandName === "help") await interaction.reply({ embeds: [helpEmbed()] });
}

async function syncSelfRoles(guildId: string) {
  const config = await settings.load(guildId).catch(() => null);
  if (!config) return;
  const guild = client.guilds.cache.get(guildId); if (!guild) return;
  for (const roleConfig of config.selfRoles) {
    const channel = await guild.channels.fetch(roleConfig.channelId).catch(() => null);
    if (!(channel instanceof TextChannel)) continue;
    const button = new ButtonBuilder().setCustomId(`selfrole:${roleConfig.roleId}`).setLabel(roleConfig.label).setStyle(ButtonStyle.Secondary);
    if (roleConfig.emoji) button.setEmoji(roleConfig.emoji);
    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const targetCustomId = `selfrole:${roleConfig.roleId}`;
    const existing = messages?.find(message => message.author.id === client.user?.id && JSON.stringify(message.components).includes(`"custom_id":"${targetCustomId}"`));
    if (!existing) await channel.send({ content: "Choose your roles:", components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] }).catch(() => undefined);
  }
}

client.once(Events.ClientReady, async ready => {
  console.log(`Bot ready as ${ready.user.tag} in ${ready.guilds.cache.size} guilds`);
  settings.subscribe();
  await Promise.allSettled(ready.guilds.cache.map(guild => syncSelfRoles(guild.id)));
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(ready.user.id), { body: commands });
  await Promise.allSettled(ready.guilds.cache.map(guild => settings.load(guild.id)));
});
client.on(Events.GuildCreate, guild => settings.subscribe());
client.on(Events.GuildCreate, guild => void syncSelfRoles(guild.id));
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isButton() && interaction.customId.startsWith("selfrole:")) {
    const roleId = interaction.customId.slice("selfrole:".length);
    if (!interaction.guild || !interaction.member || !("roles" in interaction.member)) return;
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!member || !role) { await interaction.reply({ content: "That role is no longer available.", ephemeral: true }); return; }
    const hasRole = member.roles.cache.has(role.id);
    await (hasRole ? member.roles.remove(role, "Self-role toggle") : member.roles.add(role, "Self-role toggle")).catch(async () => { await interaction.reply({ content: "I cannot manage that role.", ephemeral: true }); });
    if (!interaction.replied) await interaction.reply({ content: hasRole ? `Removed ${role.name}.` : `Added ${role.name}.`, ephemeral: true });
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  try {
    await replyToCommand(interaction);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed`, error);
    const response = { content: "Something went wrong while processing that command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(response).catch(() => undefined);
    else await interaction.reply(response).catch(() => undefined);
  }
});
client.on(Events.PresenceUpdate, async (_oldPresence, presence) => {
  if (!presence.guild || !presence.userId) return;
  const config = await settings.load(presence.guild.id).catch(() => null);
  if (!config?.statusRoleEnabled || !config.statusRoleId || !config.targetStatus) return;
  const targetStatus = config.targetStatus;
  const member = await presence.guild.members.fetch(presence.userId).catch(() => null);
  const role = await presence.guild.roles.fetch(config.statusRoleId).catch(() => null);
  if (!member || !role) return;
  const matches = presence.activities.some(activity => `${activity.state ?? ""} ${activity.name}`.toLowerCase().includes(targetStatus.toLowerCase()));
  if (matches && !member.roles.cache.has(role.id)) await member.roles.add(role, "Status role match").catch(() => undefined);
  if (!matches && member.roles.cache.has(role.id)) await member.roles.remove(role, "Status role removed").catch(() => undefined);
});
client.on(Events.GuildMemberAdd, async member => {
  const config = await settings.load(member.guild.id);
  if (!config.welcomeEnabled || !config.welcomeChannelId) return;
  const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const content = config.welcomeMessage.replaceAll("{server}", member.guild.name).replaceAll("{user}", `<@${member.id}>`);
  await channel.send({ content }).catch(() => undefined);
});
client.on(Events.GuildMemberRemove, async member => {
  const config = await settings.load(member.guild.id);
  if (!config.welcomeEnabled || !config.welcomeChannelId) return;
  const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ content: config.leaveMessage.replaceAll("{server}", member.guild.name).replaceAll("{user}", member.user.username) }).catch(() => undefined);
});
client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  if (await enforceGifOnlyChannel(message)) return;
  const config = await settings.load(message.guild.id);
  const normalized = message.content.toLowerCase();
  if (config.autoMod && config.blacklistedWords.some(word => normalized.includes(word.toLowerCase()))) {
    await message.delete().catch(() => undefined);
    await message.channel.send({ content: `${message.author}, that message was removed by Auto-Mod.` }).then(reply => setTimeout(() => reply.delete().catch(() => undefined), 5000)).catch(() => undefined);
    return;
  }
  if (config.antiLink && /https?:\/\/|discord\.gg\//i.test(message.content) && !message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await message.delete().catch(() => undefined); return;
  }
  if (config.antiSpam) await enforceRepeatedMessageTimeout(message);
});
client.on(Events.Error, error => console.error("Discord client error", error));
process.once("SIGTERM", () => { clearInterval(trackingCleanup); settings.close(); client.destroy(); });
client.login(env.DISCORD_BOT_TOKEN);
