const {
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");

/**
 * Register a Join-to-Create voice-state handler.
 *
 * Usage:
 *   require("./j2cVoiceStateUpdate")(client, {
 *     joinToCreateChannelId: process.env.JOIN_TO_CREATE_CHANNEL_ID,
 *     categoryId: process.env.J2C_CATEGORY_ID,
 *   });
 *
 * `categoryId` is optional. When omitted, the temporary channel is created
 * in the same category as the trigger channel.
 */
module.exports = function registerJ2C(client, options = {}) {
  const joinToCreateChannelId = options.joinToCreateChannelId;
  const configuredCategoryId = options.categoryId || null;
  const temporaryChannels = new Map();

  if (!joinToCreateChannelId) {
    throw new Error("J2C requires a joinToCreateChannelId.");
  }

  client.on("voiceStateUpdate", async (oldState, newState) => {
    const member = newState.member || oldState.member;
    const guild = newState.guild || oldState.guild;

    if (!member || !guild || member.user.bot) return;

    // Ignore updates where the member did not actually change channels.
    if (oldState.channelId === newState.channelId) return;

    if (newState.channelId === joinToCreateChannelId) {
      let temporaryChannel;

      try {
        const triggerChannel = newState.channel;
        const parentId = configuredCategoryId || triggerChannel?.parentId;
        const safeName = member.displayName.slice(0, 80).trim() || "User";

        temporaryChannel = await guild.channels.create({
          name: `🔊 ${safeName}'s Lounge`.slice(0, 100),
          type: ChannelType.GuildVoice,
          parent: parentId || undefined,
          reason: `J2C channel created for ${member.user.tag}`,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
            },
          ],
        });

        temporaryChannels.set(temporaryChannel.id, {
          guildId: guild.id,
          ownerId: member.id,
        });

        await member.voice.setChannel(temporaryChannel, "J2C member transfer");
      } catch (error) {
        console.error(`[J2C] Failed to create or move ${member.user.tag}:`, error);

        if (temporaryChannel) {
          temporaryChannels.delete(temporaryChannel.id);
          await temporaryChannel.delete("J2C creation failed").catch(() => {});
        }
      }
    }

    // Delete tracked temporary channels as soon as their last member leaves.
    const previousChannel = oldState.channel;
    if (!previousChannel || !temporaryChannels.has(previousChannel.id)) return;

    if (previousChannel.members.size === 0) {
      temporaryChannels.delete(previousChannel.id);
      await previousChannel.delete("J2C temporary channel is empty").catch((error) => {
        console.error(`[J2C] Failed to delete ${previousChannel.id}:`, error);
      });
    }
  });

  // Prevent stale Map entries if a temporary channel is deleted manually.
  client.on("channelDelete", (channel) => {
    temporaryChannels.delete(channel.id);
  });

  return temporaryChannels;
};