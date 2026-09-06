import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "./config.js";

export type Session = { userId: string; username: string; avatar: string | null; exp?: number };
export const sessionCookie = "zyrox_session";

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
