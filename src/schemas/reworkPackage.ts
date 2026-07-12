import { z } from "zod";

export const reworkPackageSchema = z.object({
  schemaVersion: z.literal(1),
  attempt: z.number().int().positive(),
  originalObjective: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  blockingFindings: z.array(z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    requiredChange: z.string().trim().min(1),
  })).min(1),
  preserve: z.array(z.string().trim().min(1)),
  mustChange: z.array(z.string().trim().min(1)).min(1),
  mustNotChange: z.array(z.string().trim().min(1)),
  previousAttemptSummary: z.string().trim().min(1),
});

export type ReworkPackage = z.infer<typeof reworkPackageSchema>;
