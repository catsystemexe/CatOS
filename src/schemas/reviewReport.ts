import { z } from "zod";

export const reviewVerdictSchema = z.enum(["ACCEPT", "REWORK", "HUMAN_REQUIRED", "STOP"]);

export const reviewReportSchema = z.object({
  schemaVersion: z.literal(1),
  verdict: reviewVerdictSchema,
  summary: z.string().trim().min(1),
  reviewedAcceptanceCriteria: z.array(
    z.object({
      criterion: z.string().trim().min(1),
      status: z.enum(["SATISFIED", "NOT_SATISFIED", "UNCERTAIN"]),
      evidence: z.string().trim().min(1),
    }),
  ),
  blockingFindings: z.array(
    z.object({
      id: z.string().trim().min(1),
      title: z.string().trim().min(1),
      evidence: z.string().trim().min(1),
      requiredChange: z.string().trim().min(1),
    }),
  ),
  warnings: z.array(z.string().trim().min(1)),
});

export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
