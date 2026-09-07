import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1), DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1), DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_REDIRECT_URI: z.string().url(), SESSION_SECRET: z.string().min(32),
  BOT_API_SECRET: z.string().min(32), FRONTEND_ORIGIN: z.string().url(),
  REDIS_URL: z.string().url().optional(), TOKEN_ENCRYPTION_KEY: z.string().min(32),
  PORT: z.coerce.number().default(4000)
});
export const env = envSchema.parse(process.env);
