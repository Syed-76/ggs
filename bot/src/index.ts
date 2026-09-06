import { Client, GatewayIntentBits, Partials, Events, PermissionFlagsBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config.js";
import { SettingsCache } from "./settings.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates],
  partials: [Partials.Channel]
});
const settings = new SettingsCache(() => client.guilds.cache.map(guild => guild.id));
const spam = new Map<string, { count: number; resetAt: number }>();
const commands = [new SlashCommandBuilder().setName("ping").setDescription("Check bot health").toJSON()];

client.once(Events.ClientReady, async ready => {
  console.log(`Bot ready as ${ready.user.tag} in ${ready.guilds.cache.size} guilds`);
  settings.subscribe();
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(ready.user.id), { body: commands });
  await Promise.allSettled(ready.guilds.cache.map(guild => settings.load(guild.id)));
});
client.on(Events.GuildCreate, guild => settings.subscribe());
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "ping") await interaction.reply({ content: `Pong: ${client.ws.ping}ms`, ephemeral: true });
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
