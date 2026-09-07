import { io, type Socket } from "socket.io-client";
import { Redis } from "ioredis";
import { env } from "./config.js";

export type GuildSettings = {
  guildId: string; autoMod: boolean; antiLink: boolean; antiSpam: boolean; blacklistedWords: string[];
  welcomeEnabled: boolean; welcomeMessage: string; leaveMessage: string; welcomeChannelId: string | null;
  aiEnabled: boolean; aiChannelId: string | null; economyEnabled: boolean; levelingEnabled: boolean;
  statusRoleEnabled: boolean; targetStatus: string | null; statusRoleId: string | null;
  selfRoles: Array<{ channelId: string; roleId: string; label: string; emoji?: string }>;
};
export class SettingsCache {
  private readonly values = new Map<string, GuildSettings>();
  private readonly socket: Socket;
  private readonly redis?: Redis;
  constructor(private readonly guildIds: () => string[]) {
    this.socket = io(env.CONTROL_API_URL, { auth: { role: "bot", secret: env.BOT_API_SECRET }, transports: ["websocket"] });
    this.socket.on("connect", () => this.subscribe());
    this.socket.on("settings.updated", (settings: GuildSettings) => this.values.set(settings.guildId, settings));
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL);
      void this.redis.subscribe("zyrox:settings");
      this.redis.on("message", (_channel: string, payload: string) => { const next = JSON.parse(payload) as GuildSettings; this.values.set(next.guildId, next); });
    }
  }
  subscribe() { if (this.socket.connected) this.socket.emit("bot.subscribe", this.guildIds()); }
  async load(guildId: string): Promise<GuildSettings> {
    const cached = this.values.get(guildId); if (cached) return cached;
    const response = await fetch(`${env.CONTROL_API_URL}/internal/settings/${guildId}`, { headers: { "x-bot-secret": env.BOT_API_SECRET } });
    if (!response.ok) throw new Error(`settings fetch failed: ${response.status}`);
    const data = await response.json() as { settings: GuildSettings };
    this.values.set(guildId, data.settings); return data.settings;
  }
  close() { this.socket.disconnect(); void this.redis?.quit(); }
}
