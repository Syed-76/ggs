import { z } from "zod";
export const settingsSchema = z.object({
  autoMod: z.boolean().optional(), antiLink: z.boolean().optional(), antiSpam: z.boolean().optional(),
  blacklistedWords: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  welcomeEnabled: z.boolean().optional(), welcomeMessage: z.string().max(1000).optional(),
  leaveMessage: z.string().max(1000).optional(), welcomeChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  aiEnabled: z.boolean().optional(), aiChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  economyEnabled: z.boolean().optional(), levelingEnabled: z.boolean().optional()
}).strict();
export type SettingsPatch = z.infer<typeof settingsSchema>;
