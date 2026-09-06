# Web dashboard

Copy `.env.local.example` to `.env.local`, set `NEXT_PUBLIC_API_URL`, and set `NEXT_PUBLIC_DISCORD_CLIENT_ID` to the public Discord application ID for invite links. Run `npm install` from the repository root, then `npm run dev:web`.

The API must be running on the configured URL. OAuth callbacks are handled by the API and return to `/guilds`. Settings are sent with credentialed PATCH requests and the API broadcasts updates to the bot over its authenticated Socket.IO connection.
