import "dotenv/config";
import { z } from "zod";
const schema = z.object({ DISCORD_BOT_TOKEN: z.string().min(1), CONTROL_API_URL: z.string().url(), BOT_API_SECRET: z.string().min(32), REDIS_URL: z.string().url().optional() });
export const env = schema.parse(process.env);
