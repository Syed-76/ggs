# Runtime databases

The bot creates its SQLite databases in this directory on first startup. The `.db` files are intentionally excluded from Git because they contain server configuration and user data.

For a fresh deployment, install dependencies and start the bot with:

```text
python CodeX.py
```

The database schema is initialized by the individual cogs when they are loaded. On Render, set `DATA_DIR=/data` and attach a persistent disk if database data must survive redeploys.
