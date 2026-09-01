const {
  Client,
  GatewayIntentBits,
  ActivityType,
} = require("discord.js");

// Replace these values with your own configuration.
const TARGET_STATUS = "your target status";
const ROLE_ID = "123456789012345678";
const BOT_TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("presenceUpdate", async (oldPresence, newPresence) => {
  try {
    const guild = newPresence?.guild ?? oldPresence?.guild;
    const userId = newPresence?.userId ?? oldPresence?.userId;

    if (!guild || !userId) return;

    // Fetch the member to avoid relying only on the cache.
    const member = await guild.members.fetch(userId);

    // Find the user's custom status activity.
    const customStatus = (newPresence?.activities ?? []).find(
      (activity) => activity.type === ActivityType.Custom
    );

    // Custom status text is stored in activity.state.
    const statusText = customStatus?.state ?? "";

    // Use includes() to match the target phrase anywhere in the status.
    const statusMatches = statusText.includes(TARGET_STATUS);
    const hasRole = member.roles.cache.has(ROLE_ID);

    if (statusMatches && !hasRole) {
      await member.roles.add(ROLE_ID);
      console.log(`Added role to ${member.user.tag}`);
    } else if (!statusMatches && hasRole) {
      await member.roles.remove(ROLE_ID);
      console.log(`Removed role from ${member.user.tag}`);
    }
  } catch (error) {
    console.error("Failed to update custom status role:", error);
  }
});

client.login(BOT_TOKEN);