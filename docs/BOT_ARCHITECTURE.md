# Utility and Security Bot Architecture

This repository uses Python 3, `discord.py` 2.x, SQLite via `aiosqlite`, and a
single extension entry point in `cogs/__init__.py`. Keep each feature in one
command cog plus, where necessary, one event listener cog. Do not create a
second J2C listener: `cogs/commands/j2c.py` already owns Join to Create.

## Recommended Layout

```text
core/
  feature_store.py             # shared guild feature flags/config JSON
  services/
    permissions.py             # owner/admin/role checks
    audit.py                   # audit-log lookup and deduplication
    levels.py                  # XP calculation and cooldowns
    invites.py                 # invite snapshots and attribution
cogs/
  security/
    antinuke.py                # audit-log enforcement and whitelist policy
    automod.py                 # spam, caps, links, mentions, emojis
  utility/
    server.py                  # server/user/avatar/config commands
    responder.py                # keyword replies and reactions
  moderation/
    moderation.py              # kick, ban, timeout, warn, unban
    voice.py                   # move, disconnect, mute, deafen
  community/
    welcome.py                 # welcome cards, autorole, join DM
    invites.py                 # invite tracking
    birthdays.py
  games/
    fun.py
    tictactoe.py
    trivia.py
  systems/
    giveaway.py
    ticket.py
    j2c.py                     # existing JoinToCreate implementation
    logging.py
    counting.py
    leveling.py
    sticky.py
    verification.py
    vanityroles.py
    customrole.py
    minecraft.py
    encryption.py
```

The current repository already contains most of these modules under
`cogs/commands`, `cogs/events`, and `cogs/antinuke`. Move modules only when
there is a maintenance reason; the ownership boundaries above are the target
architecture, not a migration requirement.

## Centralized State

`core/feature_store.py` provides the shared toggle/config table in
`db/features.db`:

```sql
guild_features(
  guild_id INTEGER,
  feature TEXT,
  enabled INTEGER,
  config_json TEXT,
  updated_at TEXT,
  PRIMARY KEY (guild_id, feature)
)
```

Recommended feature names are `antinuke`, `automod`, `logging`, `j2c`,
`leveling`, `counting`, `sticky`, `verification`, `vanityroles`, `giveaway`,
`ticket`, `welcomer`, `autorole`, and `invite_tracker`. Store IDs, thresholds,
role IDs, templates, and channel IDs in `config_json`; never store secrets or
raw message content there.

For a larger deployment, PostgreSQL/Supabase is the next step. Keep the same
repository interface and replace only the store implementation. SQLite is
appropriate for this bot's current single-process deployment, especially with
WAL mode and the existing persistent `DATA_DIR` setup.

## Runtime Blueprint

Initialize shared state once during extension setup:

```python
from core.feature_store import FeatureStore

async def setup(bot):
    bot.feature_store = FeatureStore()
    await bot.feature_store.initialize()
    await bot.add_cog(AntiNukeRuntime(bot))
    # J2C is already registered by cogs/commands/j2c.py.
```

The existing J2C event loop should remain the only handler for voice state
changes. Its lifecycle is:

```python
async def on_voice_state_update(self, member, before, after):
    if after.channel and after.channel.id == self.join_channel_id(member.guild.id):
        channel = await self.create_private_channel(member)
        await member.move_to(channel)
        await self.persist_private_channel(channel, member)

    if before.channel and self.is_owned_private_channel(before.channel):
        if not before.channel.members:
            await before.channel.delete(reason="J2C channel empty")
            await self.delete_private_channel_record(before.channel.id)
```

Antinuke should poll audit logs because Discord does not emit a generic
`audit_log_entry_create` gateway event. Deduplicate entries and fail closed:

```python
@tasks.loop(seconds=3)
async def audit_loop(self):
    for guild in self.bot.guilds:
        enabled, config = await self.bot.feature_store.get(guild.id, "antinuke")
        if not enabled:
            continue
        async for entry in guild.audit_logs(limit=25):
            if entry.id in self.seen_entries:
                continue
            self.seen_entries.add(entry.id)
            if entry.action not in self.protected_actions:
                continue
            if await self.is_trusted(guild, entry.user, config):
                continue
            await self.handle_unauthorized_action(guild, entry)
```

`handle_unauthorized_action` should check bot hierarchy, record the event,
revoke dangerous roles where possible, and only ban an executor when the
configured threshold is reached. Always whitelist the guild owner and explicit
trusted IDs, and never punish the bot's own user.

## Event and Data Ownership

| Feature | Main event/API | Persistent data |
| --- | --- | --- |
| Antinuke | audit-log poller | enabled, trusted IDs, thresholds, log channel |
| Automod | `on_message` | rules, ignored channels/roles, strikes |
| Logging | Discord listeners | event-to-channel routing |
| J2C | `on_voice_state_update` | trigger channel, private channels, owners |
| Invite tracker | `on_member_join` + invite snapshots | inviter and uses |
| Leveling | `on_message`, voice loop | XP, level roles, cooldowns |
| Counting | `on_message` | current number, last member, channel |
| Sticky | `on_message` | channel and sticky message ID |
| Verification | button/modal interaction | verify channel, role, attempts |
| Giveaway | task loop | end time, prize, winners, entries |
| Birthday | daily task loop | user birthday and timezone |

## Safety Requirements

- Use `guild_only`, permission checks, cooldowns, and bot hierarchy checks on
  every administrative command.
- Make all background loops idempotent and cancel them in `cog_unload`.
- Cache only short-lived invite/audit snapshots; persist authoritative state.
- Use parameterized SQL exclusively.
- Treat external services (Minecraft status, captcha providers, meme APIs) as
  time-bounded calls with graceful failure messages.
- Log enforcement decisions with guild, executor, action, target, and reason,
  but do not log message contents by default.