import "dotenv/config";
import { z } from "zod";
const schema = z.object({
	DISCORD_BOT_TOKEN: z.string().min(1), CONTROL_API_URL: z.string().url(), BOT_API_SECRET: z.string().min(32), REDIS_URL: z.string().url().optional(),
	GIF_ONLY_CHANNEL_IDS: z.string().optional(), GIF_ONLY_CHANNEL_NAME: z.string().trim().min(1).default("gifs")
});
export const env = schema.parse(process.env);
