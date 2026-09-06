# All-in-One Discord Platform Blueprint

This repository is already a Python `discord.py` 2.x bot. The recommended production path is to keep that runtime, split new capabilities into focused cogs/services, and run a separate Next.js dashboard. Do not add a second bot process or a second `on_message`/voice-state pipeline.

## 1. Target Architecture

```text
Discord Gateway/API
        |
        v
bot process (discord.py, AutoShardedBot)
  cogs/
    moderation/       ban, kick, timeout, warn, clear
    automod/          spam, links, raids, words, strikes
    community/        xp, invites, level rewards
    economy/          wallet, work, shop, gamble
    games/            trivia, quiz, interactive games
    support/          tickets, buttons, modals
    ai/               text chat and voice adapter
    observability/    audit/mod/action logging
  core/services/      authoritative business logic
  core/repositories/  PostgreSQL/Supabase or SQLite adapters
        |
        | Redis pub/sub or signed HTTP commands
        v
control-plane API (FastAPI)
        |
        v
Next.js dashboard (Discord OAuth2, admin UI)
```

### Repository mapping

- Keep `core.zyrox` as the only bot construction/lifecycle owner.
- Keep extension registration in `cogs/__init__.py`; add new cogs there.
- Put shared configuration behind `core.feature_store.FeatureStore`.
- Keep Discord-facing code in cogs and put XP, invite attribution, economy, and punishment decisions in services.
- Keep `utils.supabase_client` behind a repository interface. The bot must still be testable without a live dashboard or provider.
- The current SQLite/persistent `DATA_DIR` approach is suitable for one process. Use PostgreSQL/Supabase plus Redis before running multiple bot replicas.

## 2. Feature Ownership

| Module | Discord surface | Durable records |
| --- | --- | --- |
| `security` | `on_message`, member/join events, slash commands | rules, strikes, raid windows, punishments |
| `moderation` | `/ban`, `/kick`, `/timeout`, `/warn`, `/clear` | action log, warnings |
| `community` | message/voice XP and invite events | member XP, levels, invite snapshots |
| `economy` | `/work`, `/balance`, `/shop`, `/gamble` | wallet ledger, inventory, cooldowns |
| `games` | buttons/modals and slash commands | optional match history |
| `support` | `/ticket`, button and modal interactions | ticket state, transcripts |
| `ai` | configured text channel and voice adapter | opt-in settings, usage/cost limits |
| `dashboard` | signed API commands | feature configuration and command audit |

Every administrative action should produce one structured action record containing `guild_id`, `actor_id`, `target_id`, `action`, `reason`, `source`, and `created_at`. Never persist raw message content by default.

## 3. Configuration and Secrets

Use environment variables for secrets and guild-specific settings in the feature store. A minimal `.env.example`:

```dotenv
TOKEN=
DATABASE_URL=postgresql://user:password@host:5432/zyrox
REDIS_URL=redis://localhost:6379/0
DASHBOARD_ORIGIN=http://localhost:3000
CONTROL_API_URL=http://localhost:8000
CONTROL_API_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/callback
OPENAI_API_KEY=
AI_MODEL=gpt-4o-mini
```

Never put `TOKEN`, OAuth client secrets, AI keys, or webhook signing secrets in `config.yml`, the feature store, logs, or client-side Next.js code.

## 4. Bot Entry Template

The existing `CodeX.py` is the production entry point. Use this smaller shape for a new deployment or as a refactoring target; retain the existing `zyrox` subclass if the current commands depend on it.

```python
# bot/main.py
from __future__ import annotations

import asyncio
import logging
import os

import discord
from discord.ext import commands
from dotenv import load_dotenv

from core.feature_store import FeatureStore

load_dotenv()
log = logging.getLogger("zyrox")

EXTENSIONS = (
    "cogs.security.automod",
    "cogs.moderation.moderation",
    "cogs.community.leveling",
    "cogs.community.invites",
    "cogs.economy.economy",
    "cogs.games.trivia",
    "cogs.support.tickets",
    "cogs.ai.chat",
)

class Bot(commands.AutoShardedBot):
    def __init__(self) -> None:
        intents = discord.Intents.none()
        intents.guilds = True
        intents.members = True
        intents.messages = True
        intents.message_content = True
        intents.voice_states = True
        intents.invites = True
        super().__init__(
            command_prefix=commands.when_mentioned_or("!"),
            intents=intents,
            allowed_mentions=discord.AllowedMentions(
                everyone=False, roles=False, replied_user=False
            ),
        )
        self.feature_store = FeatureStore()
        self.redis = None

    async def setup_hook(self) -> None:
        await self.feature_store.initialize()
        for extension in EXTENSIONS:
            try:
                await self.load_extension(extension)
            except Exception:
                log.exception("Failed to load extension %s", extension)
                raise
        # In production, use a test guild during development and global sync on release.
        await self.tree.sync()

    async def on_ready(self) -> None:
        log.info("Ready as %s in %d guilds", self.user, len(self.guilds))

    async def close(self) -> None:
        await self.feature_store.close()
        await super().close()

async def main() -> None:
    token = os.environ["TOKEN"]
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    bot = Bot()
    async with bot:
        await bot.start(token)

if __name__ == "__main__":
    asyncio.run(main())
```

Do not blindly copy this over `CodeX.py`: the current app already loads a large extension set from `cogs/__init__.py`, starts sync tasks, and owns Join-to-Create voice handling.

## 5. Moderation and Automod Contract

Use Discord permission checks and hierarchy checks for every command. A moderation service should be the only place that applies punishments:

```python
import datetime

async def enforce(member: discord.Member, action: str, reason: str) -> None:
    if member.bot or member == member.guild.me:
        return
    if member.top_role >= member.guild.me.top_role:
        raise ValueError("target is above the bot hierarchy")
    if action == "timeout":
        await member.timeout(datetime.timedelta(minutes=10), reason=reason)
    elif action == "kick":
        await member.kick(reason=reason)
    elif action == "ban":
        await member.ban(reason=reason, delete_message_seconds=0)
    else:
        raise ValueError(f"unsupported action: {action}")
```

Recommended automod pipeline:

1. Ignore bots, DMs, configured channels, and trusted roles.
2. Check raid join velocity, duplicate messages, links/invites, mentions, caps, and configured words.
3. Add a strike with an expiry; do not use an unbounded in-memory counter.
4. Apply the configured action through the moderation service.
5. Log the decision with IDs and rule name, not message contents.
6. Rate-limit warnings and log writes so a raid cannot exhaust API limits.

`/clear` must cap bulk deletion at Discord's limit per request, require `manage_messages`, and report the count ephemerally. `ban`, `kick`, and `timeout` must be guild-only, require the matching permission, and reject targets above the bot's role.

## 6. XP and Invites

Use separate cooldowns for text and voice. XP should be awarded transactionally so duplicate gateway deliveries cannot double-award it.

```sql
create table guild_members (
  guild_id bigint not null,
  user_id bigint not null,
  xp bigint not null default 0,
  level integer not null default 0,
  coins bigint not null default 0,
  last_text_xp_at timestamptz,
  primary key (guild_id, user_id)
);

create table invite_snapshots (
  guild_id bigint not null,
  code text not null,
  inviter_id bigint,
  uses integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (guild_id, code)
);

create table moderation_actions (
  id bigserial primary key,
  guild_id bigint not null,
  actor_id bigint not null,
  target_id bigint,
  action text not null,
  reason text,
  source text not null,
  created_at timestamptz not null default now()
);
```

For invites, snapshot uses on startup and after `on_invite_create`/`on_invite_delete`, compare snapshots on member join, and mark an attribution as fake until the member passes the configured age/verification window. On leave, decrement only the inviter's valid count; retain the event for auditability. Do not infer invites from a single cache after a restart.

## 7. Economy and Games

Use a ledger rather than mutating a balance without history:

```sql
create table economy_ledger (
  id bigserial primary key,
  guild_id bigint not null,
  user_id bigint not null,
  delta bigint not null,
  reason text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
```

`/work` and `/gamble` need per-user, per-guild cooldowns and an idempotency key. Never let the client supply payout values. `/shop` purchases should be a transaction that checks the price and inserts inventory once. Trivia questions must be sourced from a reviewed dataset or a provider with timeouts and content filtering.

## 8. AI Chat and Voice

AI chat should be opt-in per channel, bounded by a per-user and per-guild budget, and protected by a timeout. Keep conversation history short and redact secrets before sending external requests. Use the provider's async client and never block the gateway event loop.

Voice requires explicit consent and a separate voice-receive implementation; Discord's normal bot API does not provide turnkey transcription. The adapter should:

- announce recording/transcription state in the channel;
- require an admin toggle and user opt-in;
- buffer short utterances, enforce a maximum duration, and discard audio after transcription;
- send text to the AI provider only after applying the same safety and budget checks;
- generate TTS into the voice connection with a queue and cancellation on disconnect.

Treat voice audio and transcripts as sensitive data. Document retention and obtain consent from server members.

## 9. Tickets with Buttons and Modals

A ticket cog should create a private channel after validating the guild's category, support role, and per-user open-ticket limit. The button opens a modal for subject/details, validates length, and stores the ticket ID. Add `Close`, `Claim`, and `Transcript` buttons with permission checks. Transcript generation must redact tokens and be rate-limited.

## 10. Dashboard API

Use a separate FastAPI service. The dashboard never receives the bot token and never calls Discord with arbitrary user-provided JSON. The API validates the Discord OAuth identity, checks that the user has administrator or `manage_guild` permission in the selected guild, and writes a command to a durable outbox.

```python
# control_api/main.py
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Zyrox Control API")

class FeatureUpdate(BaseModel):
    enabled: bool
    log_channel_id: int | None = Field(default=None, gt=0)

@app.put("/v1/guilds/{guild_id}/features/{feature}")
async def update_feature(
    guild_id: int,
    feature: str,
    payload: FeatureUpdate,
    admin=Depends(require_guild_admin),
):
    if admin.guild_id != guild_id:
        raise HTTPException(403, "not a guild administrator")
    await feature_store.set(guild_id, feature, payload.enabled, payload.model_dump())
    await outbox.publish({
        "type": "feature.updated",
        "guild_id": guild_id,
        "feature": feature,
        "config": payload.model_dump(),
    })
    return {"ok": True}
```

For a single-host deployment, signed HTTP webhooks are sufficient. For multiple bot workers, use Redis Streams or PostgreSQL `LISTEN/NOTIFY` plus an outbox table. Every command needs a UUID, issuer, timestamp, expiration, and idempotency check. The bot re-checks permissions and feature state before executing it, then acknowledges success/failure back to the API.

## 11. Next.js Dashboard Shape

```text
web/
  app/
    (auth)/login/page.tsx
    dashboard/[guildId]/page.tsx
    dashboard/[guildId]/moderation/page.tsx
    dashboard/[guildId]/automod/page.tsx
    dashboard/[guildId]/levels/page.tsx
    dashboard/[guildId]/economy/page.tsx
    dashboard/[guildId]/ai/page.tsx
    api/auth/discord/route.ts
    api/auth/callback/route.ts
  components/
    sidebar.tsx
    feature-toggle.tsx
    audit-table.tsx
    channel-picker.tsx
  lib/
    discord-oauth.ts
    control-api.ts
    session.ts
```

Use a charcoal background, near-black navigation rail, one restrained accent color, high-contrast typography, compact data tables, and clear status badges. Prefer tabs and toggles for configuration, channel/role pickers for Discord IDs, and confirmation dialogs for destructive actions. Keep all privileged mutations server-side in Next.js route handlers; never expose `DISCORD_CLIENT_SECRET` or `CONTROL_API_SECRET` to the browser.

OAuth flow:

1. Redirect to Discord with `identify guilds` scopes and a random state value.
2. Validate state and exchange the code server-to-server.
3. Fetch the user's guilds and only show guilds where Discord reports administrator/manage-guild access.
4. Store an encrypted, short-lived session cookie; do not store the Discord access token in local storage.
5. Refresh or expire the session server-side and revoke it on logout.

## 12. Deployment Checklist

- Enable only the privileged intents actually required and enable them in the Discord Developer Portal.
- Set bot role hierarchy above roles it must manage, but below the owner role.
- Use PostgreSQL/Supabase for authoritative state and Redis for cooldowns/pub-sub when scaling beyond one process.
- Run bot, control API, and Next.js as separate services with health checks.
- Add structured logs, error reporting, API request IDs, and metrics for command latency, Discord rate limits, queue depth, and automod decisions.
- Run migrations before deploying code; back up the database.
- Set CORS to the exact dashboard origin and verify webhook signatures with constant-time comparison.
- Add tests for hierarchy checks, automod strikes, invite fake/leave handling, economy idempotency, OAuth authorization, and dashboard command authorization.
- Deploy globally synced slash commands only after testing in a development guild.

## 13. Local Runbook

```powershell
# Bot
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python CodeX.py

# Dashboard (separate project)
npm install
npm run dev
```

The first implementation slice should be moderation logging plus the shared feature store, then leveling/invites, then economy/games, and finally AI/voice. This order gives the platform durable permissions and observability before adding expensive external integrations.
