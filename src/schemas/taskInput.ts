import { z } from "zod";

export const taskInputSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  goal: z.string().min(1),
  createdAt: z.string().datetime(),
  configPath: z.string().min(1),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
