import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { Redis } from "ioredis";
import { env } from "./config.js";
import { prisma } from "./db.js";
import { botAuthHeaders, canManageGuild, createSession, discordFetch, encryptToken, readSession, requireSession, sessionCookie, userAccessToken } from "./auth.js";
import { settingsSchema } from "./validation.js";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: env.FRONTEND_ORIGIN, credentials: true } });
const redis = env.REDIS_URL ? new Redis(env.REDIS_URL) : null;
app.set("trust proxy", 1);
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true }));

const oauthState = new Map<string, number>();
const botGuildCache = { ids: new Set<string>(), expiresAt: 0 };
async function botGuildIds(): Promise<Set<string>> {
  if (botGuildCache.expiresAt > Date.now()) return botGuildCache.ids;
  const guilds = await discordFetch("/users/@me/guilds", { headers: botAuthHeaders() });
  botGuildCache.ids = new Set(guilds.map((guild: { id: string }) => guild.id));
  botGuildCache.expiresAt = Date.now() + 30_000;
  return botGuildCache.ids;
}
async function eligibleGuild(guildId: string, userId: string) {
  const guilds = await discordFetch(`/users/@me/guilds`, { headers: { Authorization: `Bearer ${userId}` } }).catch(() => []);
  return guilds.find((guild: { id: string; permissions: string }) => guild.id === guildId && canManageGuild(guild.permissions));
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "control-api" }));
app.get("/api/auth/login", (_req, res) => {
  const state = crypto.randomUUID(); oauthState.set(state, Date.now() + 300_000);
  const params = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: env.DISCORD_REDIRECT_URI, response_type: "code", scope: "identify guilds", state });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get("/api/auth/callback", async (req, res) => {
  const state = String(req.query.state ?? ""); const code = String(req.query.code ?? "");
  const stateExpiry = oauthState.get(state);
  if (!code || stateExpiry === undefined || stateExpiry < Date.now()) { res.status(400).send("Invalid OAuth state"); return; }
  oauthState.delete(state);
  try {
    const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: env.DISCORD_REDIRECT_URI }) });
    if (!tokenResponse.ok) throw new Error("OAuth token exchange failed");
    const token = await tokenResponse.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
    const user = await discordFetch("/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } });
    await prisma.user.upsert({ where: { id: user.id }, create: { id: user.id, username: user.username, avatar: user.avatar ?? null }, update: { username: user.username, avatar: user.avatar ?? null } });
    await prisma.oAuthAccount.upsert({ where: { userId: user.id }, create: { userId: user.id, accessTokenCipher: encryptToken(token.access_token), refreshTokenCipher: encryptToken(token.refresh_token), expiresAt: new Date(Date.now() + token.expires_in * 1000), scope: token.scope }, update: { accessTokenCipher: encryptToken(token.access_token), refreshTokenCipher: encryptToken(token.refresh_token), expiresAt: new Date(Date.now() + token.expires_in * 1000), scope: token.scope } });
    const session = createSession({ userId: user.id, username: user.username, avatar: user.avatar ?? null });
    res.cookie(sessionCookie, session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.redirect(`${env.FRONTEND_ORIGIN}/guilds`);
  } catch { res.status(502).send("Discord authentication failed"); }
});
app.post("/api/auth/logout", (_req, res) => { res.clearCookie(sessionCookie); res.clearCookie("discord_access_token"); res.status(204).end(); });
app.get("/api/auth/me", requireSession, (req, res) => res.json({ user: res.locals.session }));

app.get("/api/guilds", requireSession, async (_req, res) => {
  try {
    const accessToken = await userAccessToken(res.locals.session.userId);
    if (!accessToken) { res.status(401).json({ error: "discord_token_expired" }); return; }
    const userGuilds = await discordFetch("/users/@me/guilds", { headers: { Authorization: `Bearer ${accessToken}` } });
    const botIds = await botGuildIds();
    res.json({ guilds: userGuilds.filter((guild: { permissions: string }) => canManageGuild(guild.permissions)).map((guild: { id: string; name: string; icon: string | null }) => ({ ...guild, botPresent: botIds.has(guild.id) })) });
  } catch { res.status(502).json({ error: "guild_fetch_failed" }); }
});

app.get("/api/guilds/:guildId/channels", requireSession, async (req, res) => {
  const guildId = routeGuildId(req);
  if (!(await assertGuildAccess(req, guildId))) { res.status(403).json({ error: "guild_access_denied" }); return; }
  try {
    const channels = await discordFetch(`/guilds/${guildId}/channels`, { headers: botAuthHeaders() });
    res.json({ channels: channels.filter((channel: { type: number }) => channel.type === 0 || channel.type === 5).map((channel: { id: string; name: string; type: number }) => ({ id: channel.id, name: channel.name, type: channel.type })) });
  } catch { res.status(502).json({ error: "channel_fetch_failed" }); }
});

app.get("/api/guilds/:guildId/stats", requireSession, async (req, res) => {
  const guildId = routeGuildId(req);
  if (!(await assertGuildAccess(req, guildId))) { res.status(403).json({ error: "guild_access_denied" }); return; }
  try {
    const guild = await discordFetch(`/guilds/${req.params.guildId}?with_counts=true`, { headers: botAuthHeaders() });
    res.json({ members: guild.approximate_member_count ?? 0, online: guild.approximate_presence_count ?? 0, botPresent: (await botGuildIds()).has(guildId) });
  } catch { res.status(502).json({ error: "stats_fetch_failed" }); }
});

async function assertGuildAccess(req: express.Request, guildId: string) {
  if (!resSession(req)) return false;
  const authSession = readSession(req);
  const accessToken = authSession ? await userAccessToken(authSession.userId) : null;
  if (!accessToken) return false;
  const guilds = await discordFetch("/users/@me/guilds", { headers: { Authorization: `Bearer ${accessToken}` } });
  return guilds.some((guild: { id: string; permissions: string }) => guild.id === guildId && canManageGuild(guild.permissions));
}
function resSession(req: express.Request) { return req.cookies?.[sessionCookie] ? true : false; }
function routeGuildId(req: express.Request): string { return String(req.params.guildId); }

app.get("/api/settings/:guildId", requireSession, async (req, res) => {
  const guildId = routeGuildId(req);
  if (!(await assertGuildAccess(req, guildId))) { res.status(403).json({ error: "guild_access_denied" }); return; }
  const settings = await prisma.serverSettings.upsert({ where: { guildId }, create: { guildId }, update: {} });
  res.json({ settings });
});

app.get("/internal/settings/:guildId", async (req, res) => {
  if (req.header("x-bot-secret") !== env.BOT_API_SECRET) { res.status(401).json({ error: "unauthorized" }); return; }
  const guildId = routeGuildId(req);
  const settings = await prisma.serverSettings.upsert({ where: { guildId }, create: { guildId }, update: {} });
  res.json({ settings });
});
app.patch("/api/settings/:guildId", requireSession, async (req, res) => {
  const guildId = routeGuildId(req);
  if (!(await assertGuildAccess(req, guildId))) { res.status(403).json({ error: "guild_access_denied" }); return; }
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "invalid_settings", details: parsed.error.flatten() }); return; }
  const settings = await prisma.serverSettings.upsert({ where: { guildId }, create: { guildId, ...parsed.data }, update: parsed.data });
  await prisma.dashboardAudit.create({ data: { guildId, userId: res.locals.session.userId, action: "settings.updated", payload: parsed.data } });
  io.to(`guild:${guildId}`).emit("settings.updated", settings);
  await redis?.publish("zyrox:settings", JSON.stringify(settings));
  res.json({ settings });
});

io.use((socket, next) => { if (socket.handshake.auth?.role === "bot" && socket.handshake.auth?.secret === env.BOT_API_SECRET) return next(); next(new Error("unauthorized")); });
io.on("connection", socket => { socket.on("bot.subscribe", (guildIds: string[]) => socket.join(guildIds.map(id => `guild:${id}`))); });
httpServer.listen(env.PORT, () => console.log(`Control API listening on :${env.PORT}`));
