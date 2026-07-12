import { z } from "zod";

export const taskBriefSchema = z.object({
  objective: z.string().trim().min(1, "objective must not be empty"),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1, "acceptanceCriteria must contain at least one item"),
  nonGoals: z.array(z.string().trim().min(1)),
  codexInstruction: z.string().trim().min(1, "codexInstruction must not be empty"),
  riskLevel: z.enum(["trivial", "standard", "critical"]),
});

export type TaskBrief = z.infer<typeof taskBriefSchema>;
