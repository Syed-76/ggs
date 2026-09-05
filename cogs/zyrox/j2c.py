import discord

from discord.ext import commands
from utils.emojis import e as _e

class _J2C(commands.Cog):

    def __init__(self, bot):

        self.bot = bot

    """Join To Create"""

    def help_custom(self):

              emoji = _e('zyrox_system')

              label = "J2C"

              description = "Show you Commands of J2C"

              return emoji, label, description

    @commands.group(name="j2c", invoke_without_command=True)

    async def __J2C__(self, ctx: commands.Context):

        """Manage the Join-to-Create voice channel system."""
        await ctx.send(
            "**J2C | Join to Create**\n\n"
            "Create private voice channels automatically when members join a trigger channel.\n\n"
            f"**Setup:** `{ctx.prefix}j2csetup` (Administrator)\n"
            f"**Reset:** `{ctx.prefix}j2creset` (Administrator)"
        )
