import { Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder, TextChannel, type ChatInputCommandInteraction } from "discord.js";
import { env } from "./config.js";
import { SettingsCache } from "./settings.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});
const settings = new SettingsCache(() => client.guilds.cache.map(guild => guild.id));
const spam = new Map<string, { count: number; resetAt: number }>();
const botCreationDate = process.env.BOT_CREATION_DATE ?? "September 7, 2026";
const commands = [
  new SlashCommandBuilder().setName("ping").setDescription("Check bot health"),
  new SlashCommandBuilder().setName("voteinfo").setDescription("Learn about the bot and its features"),
  new SlashCommandBuilder().setName("help").setDescription("Browse available commands and dashboard features")
].map(command => command.toJSON());

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
  if (config.antiSpam) {
    const key = `${message.guild.id}:${message.author.id}`; const now = Date.now(); const entry = spam.get(key);
    if (!entry || entry.resetAt < now) spam.set(key, { count: 1, resetAt: now + 7000 });
    else { entry.count += 1; if (entry.count >= 6) { await message.member?.timeout(60_000, "Auto-Mod spam").catch(() => undefined); spam.delete(key); } }
  }
});
client.on(Events.Error, error => console.error("Discord client error", error));
process.once("SIGTERM", () => { settings.close(); client.destroy(); });
client.login(env.DISCORD_BOT_TOKEN);
