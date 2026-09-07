import jwt from "jsonwebtoken";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "./config.js";
import { prisma } from "./db.js";

export type Session = { userId: string; username: string; avatar: string | null; exp?: number };
export const sessionCookie = "zyrox_session";
const encryptionKey = createHash("sha256").update(env.TOKEN_ENCRYPTION_KEY).digest();

export function encryptToken(value: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function decryptToken(value: string): string {
  const [iv, tag, encrypted] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
export async function userAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.oAuthAccount.findUnique({ where: { userId } });
  if (!account) return null;
  if (account.expiresAt > new Date()) return decryptToken(account.accessTokenCipher);
  const response = await fetch("https://discord.com/api/v10/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: decryptToken(account.refreshTokenCipher) }) });
  if (!response.ok) return null;
  const token = await response.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
  await prisma.oAuthAccount.update({ where: { userId }, data: { accessTokenCipher: encryptToken(token.access_token), refreshTokenCipher: encryptToken(token.refresh_token), expiresAt: new Date(Date.now() + token.expires_in * 1000), scope: token.scope } });
  return token.access_token;
}

export function createSession(session: Session): string {
  return jwt.sign(session, env.SESSION_SECRET, { algorithm: "HS256", expiresIn: "7d" });
}
export function readSession(req: Request): Session | null {
  const token = req.cookies?.[sessionCookie];
  if (!token) return null;
  try { return jwt.verify(token, env.SESSION_SECRET, { algorithms: ["HS256"] }) as Session; } catch { return null; }
}
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const session = readSession(req);
  if (!session) { res.status(401).json({ error: "authentication_required" }); return; }
  res.locals.session = session;
  next();
}
export async function discordFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://discord.com/api/v10${path}`, init);
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<any>;
}
export function canManageGuild(permissions: string): boolean {
  const value = BigInt(permissions);
  return (value & 0x8n) === 0x8n || (value & 0x20n) === 0x20n;
}
export function botAuthHeaders(): HeadersInit {
  return { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" };
}
