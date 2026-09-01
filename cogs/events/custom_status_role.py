import logging
import os

import discord
from discord.ext import commands

from core import zyrox, Cog

logger = logging.getLogger(__name__)


def _get_role_ids() -> list[int]:
    value = os.getenv("ROLE_IDS", os.getenv("ROLE_ID", ""))
    role_ids = []
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        try:
            role_ids.append(int(item))
        except ValueError:
            logger.error("Ignoring invalid custom status role ID: %s", item)
    return role_ids


class CustomStatusRole(Cog):
    """Adds configured roles while a member's custom status contains a phrase."""

    def __init__(self, bot: zyrox):
        self.bot = bot
        self.target_status = os.getenv("TARGET_STATUS", "").strip()
        self.role_ids = _get_role_ids()

    @commands.Cog.listener()
    async def on_presence_update(
        self,
        before: discord.Member | discord.Presence,
        after: discord.Member | discord.Presence,
    ):
        if not self.target_status or not self.role_ids:
            return

        guild = getattr(after, "guild", None)
        user_id = getattr(after, "id", None) or getattr(after, "user_id", None)
        if guild is None or user_id is None:
            return

        try:
            member = await guild.fetch_member(user_id)
            roles = await guild.fetch_roles()
            configured_roles = [
                role for role in roles if role.id in self.role_ids
            ]
            missing_role_ids = set(self.role_ids) - {role.id for role in configured_roles}

            if missing_role_ids:
                logger.error("Custom status roles %s were not found in guild %s.", missing_role_ids, guild.id)
                return

            bot_member = guild.me or await guild.fetch_member(self.bot.user.id)
            if any(not role.is_assignable() or role >= bot_member.top_role for role in configured_roles):
                logger.error("Cannot manage one or more custom status roles in guild %s; check role hierarchy and permissions.", guild.id)
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

            if should_have_role:
                roles_to_add = [role for role in configured_roles if role not in member.roles]
                if roles_to_add:
                    await member.add_roles(*roles_to_add, reason="Custom status role match")
            else:
                roles_to_remove = [role for role in configured_roles if role in member.roles]
                if roles_to_remove:
                    await member.remove_roles(*roles_to_remove, reason="Custom status no longer matches")
        except discord.Forbidden:
            logger.warning("Missing permission to manage the custom status role in guild %s.", guild.id)
        except discord.HTTPException as error:
            logger.error("Discord API error while updating custom status role: %s", error)
        except Exception:
            logger.exception("Unexpected custom status role error in guild %s.", guild.id)
