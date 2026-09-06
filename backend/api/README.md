# Control API

1. Copy `.env.example` to `.env` and set a PostgreSQL URL plus Discord application credentials.
2. Register `DISCORD_REDIRECT_URI` exactly in the Discord Developer Portal.
3. Run `npm install` from the repository root, then `npm run db:generate` and `npm run db:push`.
4. Start with `npm run dev:api`.

The API owns OAuth2, secure HTTP-only sessions, guild permission filtering, settings validation, audit records, and the authenticated Socket.IO bridge used by the bot.
