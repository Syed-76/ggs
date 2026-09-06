# Discord bot

Copy `.env.example` to `.env`, use the same `BOT_API_SECRET` as the control API, then run `npm install` from the repository root and `npm run dev:bot`.

The bot loads settings from the internal API on startup, subscribes to `settings.updated` over Socket.IO, and uses the live cache for welcome messages and automod events. Enable the Guild Members and Message Content privileged intents in the Discord Developer Portal.
