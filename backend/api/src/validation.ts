import { z } from "zod";
export const settingsSchema = z.object({
  autoMod: z.boolean().optional(), antiLink: z.boolean().optional(), antiSpam: z.boolean().optional(),
  blacklistedWords: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  welcomeEnabled: z.boolean().optional(), welcomeMessage: z.string().max(1000).optional(),
  leaveMessage: z.string().max(1000).optional(), welcomeChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  aiEnabled: z.boolean().optional(), aiChannelId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  economyEnabled: z.boolean().optional(), levelingEnabled: z.boolean().optional(),
  statusRoleEnabled: z.boolean().optional(), targetStatus: z.string().trim().max(128).nullable().optional(),
  statusRoleId: z.string().regex(/^\d{17,20}$/).nullable().optional(),
  selfRoles: z.array(z.object({ channelId: z.string().regex(/^\d{17,20}$/), roleId: z.string().regex(/^\d{17,20}$/), label: z.string().trim().min(1).max(80), emoji: z.string().trim().max(32).optional() })).max(25).optional()
}).strict();
export type SettingsPatch = z.infer<typeof settingsSchema>;
