import { z } from "zod";

export const finalResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  status: z.enum(["ACCEPTED", "HUMAN_REQUIRED", "REWORK_LIMIT_REACHED"]),
  finalReviewVerdict: z.enum(["ACCEPT", "REWORK", "HUMAN_REQUIRED"]),
  totalCodingAttempts: z.number().int().positive(),
  reworkAttempts: z.number().int().nonnegative(),
  finalWorkspacePath: z.string().min(1),
  finalChangedFiles: z.array(z.string()),
  finalValidationStatus: z.enum(["PASS", "FAIL", "BLOCKED"]),
  finalReviewReportPath: z.string().min(1),
});

export type FinalResult = z.infer<typeof finalResultSchema>;
