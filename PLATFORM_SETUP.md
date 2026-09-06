# Zyrox Platform Setup

This adds a production-oriented Node.js platform beside the existing Python bot. Run the Node services as the active bot/dashboard deployment; do not run both bot processes against the same Discord application token.

## Services

- `backend/api`: Express control API, Discord OAuth2, Prisma/PostgreSQL, Socket.IO bridge.
- `bot`: discord.js v14 gateway process with settings cache and live automod/welcome behavior.
- `frontend`: Next.js App Router dashboard with Tailwind styling.

## Prerequisites

- Node.js 20.9 or newer and npm 10+
- PostgreSQL 15+
- A Discord application with a bot user
- Discord Developer Portal privileged intents enabled: Server Members Intent and Message Content Intent

## Discord application

1. Create an application at the Discord Developer Portal.
2. Add a bot and copy its token only into `bot/.env` and `backend/api/.env`.
3. Add the exact redirect URI `http://localhost:3000/api/auth/callback` under OAuth2 redirects.
4. Use scopes `identify guilds` for dashboard login.
5. The invite link uses `bot applications.commands` and administrator permissions in development. Before production, replace administrator with the smallest permission set the enabled features require.
6. Put the bot role above roles it must manage and below the server owner role.

## Local setup

```powershell
npm install
Copy-Item backend/api/.env.example backend/api/.env
Copy-Item bot/.env.example bot/.env
Copy-Item frontend/.env.local.example frontend/.env.local
```

Use the same 32+ character random value for `BOT_API_SECRET` in the API and bot files. Set `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `SESSION_SECRET`, and `DATABASE_URL` in `backend/api/.env`. Set `DISCORD_BOT_TOKEN`, `CONTROL_API_URL`, and `BOT_API_SECRET` in `bot/.env`. Set `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DISCORD_CLIENT_ID`, and the API's `FRONTEND_ORIGIN` in the frontend/API environments.

Initialize PostgreSQL:

```powershell
npm run db:generate
npm run db:push
```

Start all services in separate terminals:

```powershell
npm run dev:api
npm run dev:bot
npm run dev:web
```

Open `http://localhost:3000`. The API runs on `http://localhost:4000`.

## Production

1. Use a managed PostgreSQL instance and run migrations from CI instead of `db:push`.
2. Build with `npm run build`; run `npm run start` in `backend/api` and `frontend`, and `npm run start` in `bot`.
3. Set `NODE_ENV=production`, HTTPS origins, secure cookies, and a reverse proxy for the API and dashboard.
4. Store secrets in the host secret manager. Never expose the bot token, client secret, session secret, database URL, or bot API secret to Next.js client code.
5. Run one bot process per Discord token. Scale the API horizontally only with a shared PostgreSQL database and a Socket.IO adapter or a durable pub/sub layer.
6. Add database backups, health checks for `/health`, structured logs, request IDs, and alerts for Discord rate limits and Socket.IO disconnects.

## Bridge behavior

The API validates every dashboard patch against the Prisma-backed schema, checks the session user's Discord `MANAGE_GUILD` or `ADMINISTRATOR` permission, writes an audit record, and broadcasts `settings.updated` to the guild room. The bot authenticates its Socket.IO connection with `BOT_API_SECRET`, subscribes to its guilds, fetches settings after restart through `/internal/settings/:guildId`, and uses the cache during `GuildMemberAdd`, `GuildMemberRemove`, and `MessageCreate` events.

The bot intentionally re-checks settings through the API after a restart. Socket.IO is the low-latency update path, while PostgreSQL remains authoritative.
