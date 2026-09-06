import discord
from discord.ext import commands
from discord import app_commands, Interaction
from difflib import get_close_matches
from contextlib import suppress
from core import Context
from core.zyrox import zyrox
from core.Cog import Cog
from utils.Tools import getConfig
from itertools import chain
import json
from utils import help as vhelp
from utils import Paginator, DescriptionEmbedPaginator, FieldPagePaginator, TextPaginator
import asyncio
import logging
from utils.config import DASHBOARD_URL, serverLink
from utils.Tools import *
from utils.branding import get_branding, DEFAULT_COLOR, DEFAULT_BRANDING

logger = logging.getLogger(__name__)

color = DEFAULT_COLOR
client = zyrox()


def _help_embed(ctx, prefix: str = ">", total_commands: int = 589) -> discord.Embed:
  """Build the visual home page shared by prefix and slash help."""
  embed = discord.Embed(
    color=0x4A2E80,
    description=(
      f"**Get started**\n"
      f"Try `{prefix}antinuke enable` to enable server protection.\n"
      f"Prefix: `{prefix}` • Commands: `{total_commands}`"
    ),
  )
  embed.set_author(
    name="alifop24_",
    icon_url=ctx.bot.user.display_avatar.url,
  )
  embed.add_field(
    name="Main Features",
    value="\n".join([
      "Security",
      "Automoderation",
      "Utility",
      "Autoreact & Responder",
      "Moderation",
      "Autoroles & Invite-to-Voice",
      "Fun",
      "Games",
      "Ignored Channels",
      "Server Management",
      "Voice",
      "Welcomer",
      "Giveaways",
      "Tickets",
      "Invite Tracking",
      "Bot Customization",
    ]),
    inline=True,
  )
  embed.add_field(
    name="Extra Features",
    value="\n".join([
      "Advanced Logging",
      "Vanity Roles",
      "Counting",
      "J2C",
      "Boosting",
      "Leveling",
      "Sticky Messages",
      "Verification",
      "Encryption",
      "Minecraft",
      "Join DMs",
      "Birthdays",
      "Custom Roles",
    ]),
    inline=True,
  )
  embed.set_footer(
    text=f"• Help page 1/29 | Requested by: {ctx.author}"
  )
  return embed


def _category_pages(ctx, mapping):
  pages = []
  for cog, commands_in_cog in mapping.items():
    if not hasattr(cog, "help_custom"):
      continue
    try:
      _, label, description = cog.help_custom()
    except Exception:
      continue
    lines = []
    for command in commands_in_cog:
      if command.hidden:
        continue
      lines.append(f"`{ctx.prefix}{command.qualified_name}` — {command.short_doc or 'No description'}")
    if lines:
      pages.append(("", str(label), str(description or "No commands"), lines))
  return pages[:25]


class HelpFeatureView(discord.ui.View):
  def __init__(self, ctx, mapping):
    super().__init__(timeout=300)
    self.ctx = ctx
    self.pages = _category_pages(ctx, mapping)

    options = [
      discord.SelectOption(
        label=label[:100],
        value=str(index),
        description=description[:100],
      )
      for index, (_, label, description, _) in enumerate(self.pages)
    ]
    if not options:
      options = [discord.SelectOption(label="No categories available", value="none")]

    self.category_select = discord.ui.Select(
      placeholder="Select a category to see commands",
      custom_id="help_category",
      options=options,
      disabled=not self.pages,
      row=0,
    )
    self.category_select.callback = self.category_callback
    self.add_item(self.category_select)

    self.main_button = discord.ui.Button(
      label="Main Commands", style=discord.ButtonStyle.secondary,
      custom_id="help_main", row=1,
    )
    self.main_button.callback = self.main_commands
    self.add_item(self.main_button)

    self.extra_button = discord.ui.Button(
      label="Extra Commands", style=discord.ButtonStyle.secondary,
      custom_id="help_extra", row=1,
    )
    self.extra_button.callback = self.extra_commands
    self.add_item(self.extra_button)

    self.dashboard_button = discord.ui.Button(
      label="Dashboard", style=discord.ButtonStyle.link,
      url=DASHBOARD_URL, row=1,
    )
    self.add_item(self.dashboard_button)

  async def interaction_check(self, interaction: discord.Interaction) -> bool:
    if interaction.user.id != self.ctx.author.id:
      await interaction.response.send_message(
        "You must run this command to interact with it.", ephemeral=True
      )
      return False
    return True

  async def category_callback(self, interaction: discord.Interaction):
    _, label, description, lines = self.pages[int(self.category_select.values[0])]
    embed = discord.Embed(
      title=label,
      description=description,
      color=0x4A2E80,
    )
    embed.add_field(name="Commands", value="\n".join(lines[:25]), inline=False)
    embed.set_footer(text=f"Requested by: {self.ctx.author}")
    await interaction.response.edit_message(embed=embed, view=self)

  async def main_commands(self, interaction: discord.Interaction):
    await interaction.response.send_message(
      "**Main Commands**\n\nSecurity\nAutomoderation\nUtility\nAutoreact & Responder\n"
      "Moderation\nAutoroles & Invite-to-Voice\nFun\nGames\nIgnored Channels\n"
      "Server Management\nVoice\nWelcomer\nGiveaways\nTickets\nInvite Tracking\nBot Customization",
      ephemeral=True,
    )

  async def extra_commands(self, interaction: discord.Interaction):
    await interaction.response.send_message(
      "**Additional features**\nAdvanced Logging\nVanity Roles\nCounting\nJ2C\nBoosting\n"
      "Leveling\nSticky Messages\nVerification\nEncryption\nMinecraft\nJoin DMs\n"
      "Birthdays\nCustom Roles",
      ephemeral=True,
    )


class HelpCommand(commands.HelpCommand):

  async def send_ignore_message(self, ctx, ignore_type: str):
    if ignore_type == "channel":
      await ctx.reply(f"This channel is ignored.", mention_author=False)
    elif ignore_type == "command":
      await ctx.reply(f"{ctx.author.mention} This Command, Channel, or You have been ignored here.", delete_after=6)
    elif ignore_type == "user":
      await ctx.reply(f"You are ignored.", mention_author=False)

  async def on_help_command_error(self, ctx, error):
    errors = [
      commands.CommandOnCooldown, commands.CommandNotFound,
      discord.HTTPException, commands.CommandInvokeError
    ]
    if not type(error) in errors:
      await self.context.reply(f"Unknown Error Occurred\n{error.original}",
                               mention_author=False)
    else:
      if type(error) == commands.CommandOnCooldown:
        return
    return await super().on_help_command_error(ctx, error)

  async def command_not_found(self, string: str) -> None:
    ctx = self.context
    check_ignore = await ignore_check().predicate(ctx)
    check_blacklist = await blacklist_check().predicate(ctx)

    if not check_blacklist:
        return

    if not check_ignore:
        await self.send_ignore_message(ctx, "command")
        return

    cmds = (str(cmd) for cmd in self.context.bot.walk_commands())
    matches = get_close_matches(string, cmds)

    branding = await get_branding(self.context.guild.id)
    embed = discord.Embed(
        title=f"{branding['branding_name']} Helper",
        description=f">>> **Ops! Command not found with the name** `{string}`.",
        color=branding["embed_color"]
    )
    if branding.get("embed_thumbnail"):
        embed.set_thumbnail(url=branding["embed_thumbnail"])
    if branding.get("embed_banner"):
        embed.set_image(url=branding["embed_banner"])
                          
    #if matches:
        #match_list = "\n".join([f"{index}. `{match}`" for index, match in enumerate(matches, start=1)])
        #embed.add_field(name="Did you mean:", value=match_list, inline=True)

    await ctx.reply(embed=embed, mention_author=True)

  async def send_bot_help(self, mapping):
    ctx = self.context
    check_ignore = await ignore_check().predicate(ctx)
    check_blacklist = await blacklist_check().predicate(ctx)

    if not check_blacklist:
      return

    if not check_ignore:
      await self.send_ignore_message(ctx, "command")
      return
    prefix = (await getConfig(ctx.guild.id)).get("prefix", ">")
    await ctx.reply(
      embed=_help_embed(ctx, prefix=prefix),
      view=HelpFeatureView(ctx, mapping),
      mention_author=False,
    )

  async def send_command_help(self, command):
    ctx = self.context
    check_ignore = await ignore_check().predicate(ctx)
    check_blacklist = await blacklist_check().predicate(ctx)

    if not check_blacklist:
      return

    if not check_ignore:
      await self.send_ignore_message(ctx, "command")
      return

    zyrox = f">>> {command.help}" if command.help else '>>> No Help Provided...'
    embed = discord.Embed(
        description=f"""{zyrox}""",
        color=color)
    alias = ' & '.join(command.aliases)

    embed.add_field(name="**Alt cmd**",
                      value=f"```{alias}```" if command.aliases else "No Alt cmd",
                      inline=False)
    embed.add_field(name="**Usage**",
                      value=f"```{self.context.prefix}{command.signature}```\n")
    embed.set_author(name=f"{command.qualified_name.title()} Command")
    embed.set_footer(text="<[] = optional | < > = required • Use Prefix Before Commands.")
    await self.context.reply(embed=embed, mention_author=False)

  def get_command_signature(self, command: commands.Command) -> str:
    parent = command.full_parent_name
    if len(command.aliases) > 0:
      aliases = ' | '.join(command.aliases)
      fmt = f'[{command.name} | {aliases}]'
      if parent:
        fmt = f'{parent}'
      alias = f'[{command.name} | {aliases}]'
    else:
      alias = command.name if not parent else f'{parent} {command.name}'
    return f'{alias} {command.signature}'

  def common_command_formatting(self, embed_like, command):
    embed_like.title = self.get_command_signature(command)
    if command.description:
      embed_like.description = f'{command.description}\n\n{command.help}'
    else:
      embed_like.description = command.help or 'No help found...'

  async def send_group_help(self, group):
    ctx = self.context
    check_ignore = await ignore_check().predicate(ctx)
    check_blacklist = await blacklist_check().predicate(ctx)

    if not check_blacklist:
      return

    if not check_ignore:
      await self.send_ignore_message(ctx, "command")
      return

    entries = [
        (
            f"`{self.context.prefix}{cmd.qualified_name}`\n",
            f"{cmd.short_doc if cmd.short_doc else ''}\n\u200b"
        )
        for cmd in group.commands
      ]

    count = len(group.commands)

    embeds = FieldPagePaginator(
      entries=entries,
      title=f"{group.qualified_name.title()} [{count}]",
      description="< > Duty | [ ] Optional\n",
      per_page=4
    ).get_pages()   
    
    paginator = Paginator(ctx, embeds)
    await paginator.paginate()

  async def send_cog_help(self, cog):
    ctx = self.context
    check_ignore = await ignore_check().predicate(ctx)
    check_blacklist = await blacklist_check().predicate(ctx)

    if not check_blacklist:
      return

    if not check_ignore:
      await self.send_ignore_message(ctx, "command")
      return

    branding = await get_branding(ctx.guild.id)
    entries = [(
      f"`{self.context.prefix}{cmd.qualified_name}`",
      f"-# Description : {cmd.short_doc if cmd.short_doc else ''}"
      f"\n\u200b",
    ) for cmd in cog.get_commands()]
    paginator = Paginator(source=FieldPagePaginator(
      entries=entries,
      title=f"{branding['branding_name']} — {cog.qualified_name.title()} ({len(cog.get_commands())})",
      description="`<..> Required | [..] Optional`\n\n",
      color=branding["embed_color"],
      per_page=4),
                          ctx=self.context)
    await paginator.paginate()


class _SlashCtx:
  """Minimal context-like wrapper so the help View works from a slash command."""
  def __init__(self, interaction: Interaction, prefix: str = ">"):
    self.author = interaction.user
    self.bot = interaction.client
    self.guild = interaction.guild
    self.prefix = prefix


class Help(Cog, name="help"):

  def __init__(self, client: zyrox):
    self._original_help_command = client.help_command
    attributes = {
      'name': "help",
      'aliases': ['h'],
      'cooldown': commands.CooldownMapping.from_cooldown(1, 5, commands.BucketType.user),
      'help': 'Shows help about bot, a command, or a category'
    }
    client.help_command = HelpCommand(command_attrs=attributes)
    client.help_command.cog = self

  async def cog_unload(self):
    self.help_command = self._original_help_command

  @app_commands.command(name="help", description="Shows the help menu")
  @app_commands.guild_only()
  async def slash_help(self, interaction: Interaction):
    await interaction.response.defer(ephemeral=False)

    try:
      await asyncio.wait_for(self._build_and_send_help(interaction), timeout=10)
    except asyncio.TimeoutError:
      with suppress(discord.HTTPException):
        await interaction.followup.send(
          "The help menu took too long to load. Please try again.",
          ephemeral=True,
        )
    except Exception as e:
      logger.exception("slash_help failed")
      with suppress(discord.HTTPException):
        await interaction.followup.send(
          "Something went wrong while loading the help menu. Please try again.",
          ephemeral=True,
        )

  async def _build_and_send_help(self, interaction: Interaction):
    prefix = (await getConfig(interaction.guild.id)).get("prefix", ">")
    ctx = _SlashCtx(interaction, prefix=prefix)
    mapping = {
      cog: cog.get_commands()
      for cog in ctx.bot.cogs.values()
    }
    await interaction.followup.send(
      embed=_help_embed(ctx, prefix=prefix),
      view=HelpFeatureView(ctx, mapping),
    )