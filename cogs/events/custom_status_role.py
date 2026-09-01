import logging
import os

import discord
from discord.ext import commands

from core import zyrox, Cog

logger = logging.getLogger(__name__)


def _get_role_id() -> int | None:
    value = os.getenv("ROLE_ID", "").strip()
    try:
        return int(value) if value else None
    except ValueError:
        logger.error("CUSTOM_STATUS_ROLE_ID must be a Discord role ID.")
        return None


class CustomStatusRole(Cog):
    """Adds one role while a member's custom status contains a phrase."""

    def __init__(self, bot: zyrox):
        self.bot = bot
        self.target_status = os.getenv("TARGET_STATUS", "").strip()
        self.role_id = _get_role_id()

    @commands.Cog.listener()
    async def on_presence_update(
        self,
        _member: discord.Member,
        _before: discord.Presence,
        after: discord.Member | discord.Presence,
    ):
        if not self.target_status or not self.role_id:
            return

        guild = getattr(after, "guild", None)
        user_id = getattr(after, "user_id", None)
        if guild is None or user_id is None:
            return

        try:
            member = await guild.fetch_member(user_id)
            roles = await guild.fetch_roles()
            role = next((guild_role for guild_role in roles if guild_role.id == self.role_id), None)

            if role is None:
                logger.error("Custom status role %s was not found in guild %s.", self.role_id, guild.id)
                return

            bot_member = guild.me or await guild.fetch_member(self.bot.user.id)
            if not role.is_assignable() or role >= bot_member.top_role:
                logger.error("Cannot manage role %s in guild %s; check role hierarchy and permissions.", role.id, guild.id)
                return

            custom_status = next(
                (
                    activity
                    for activity in (after.activities or [])
                    if activity.type is discord.ActivityType.custom
                ),
                None,
            )
            status_text = custom_status.state if custom_status else ""
            should_have_role = self.target_status in (status_text or "")
            has_role = role in member.roles

            if should_have_role and not has_role:
                await member.add_roles(role, reason="Custom status role match")
            elif not should_have_role and has_role:
                await member.remove_roles(role, reason="Custom status no longer matches")
        except discord.Forbidden:
            logger.warning("Missing permission to manage the custom status role in guild %s.", guild.id)
        except discord.HTTPException as error:
            logger.error("Discord API error while updating custom status role: %s", error)
        except Exception:
            logger.exception("Unexpected custom status role error in guild %s.", guild.id)
