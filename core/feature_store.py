"""Shared per-guild feature flags and JSON configuration.

This store is intentionally small and async so cogs can share one schema
without each feature creating a separate database file.
"""

from __future__ import annotations

import json
from typing import Any

import aiosqlite


class FeatureStore:
    def __init__(self, path: str = "db/features.db"):
        self.path = path

    async def initialize(self) -> None:
        async with aiosqlite.connect(self.path) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS guild_features (
                    guild_id INTEGER NOT NULL,
                    feature TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    config_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (guild_id, feature)
                )
                """
            )
            await db.commit()

    async def get(self, guild_id: int, feature: str) -> tuple[bool, dict[str, Any]]:
        async with aiosqlite.connect(self.path) as db:
            async with db.execute(
                "SELECT enabled, config_json FROM guild_features WHERE guild_id = ? AND feature = ?",
                (guild_id, feature),
            ) as cursor:
                row = await cursor.fetchone()
        if not row:
            return False, {}
        try:
            config = json.loads(row[1])
        except (TypeError, json.JSONDecodeError):
            config = {}
        return bool(row[0]), config

    async def set(
        self,
        guild_id: int,
        feature: str,
        *,
        enabled: bool,
        config: dict[str, Any] | None = None,
    ) -> None:
        async with aiosqlite.connect(self.path) as db:
            await db.execute(
                """
                INSERT INTO guild_features (guild_id, feature, enabled, config_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(guild_id, feature) DO UPDATE SET
                    enabled = excluded.enabled,
                    config_json = excluded.config_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (guild_id, feature, int(enabled), json.dumps(config or {})),
            )
            await db.commit()