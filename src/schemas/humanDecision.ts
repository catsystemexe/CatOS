import { z } from "zod";

export const evidenceReviewedSchema = z.object({
  taskBrief: z.boolean(),
  finalDiff: z.boolean(),
  validationReport: z.boolean(),
  reviewReport: z.boolean(),
});

export const approvedEvidenceSchema = z.object({
  diffSha256: z.string().regex(/^[a-f0-9]{64}$/),
  validationReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewReportSha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export const humanDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().trim().min(1),
  decision: z.enum(["APPROVE", "REJECT", "REQUEST_CHANGES"]),
  decidedAt: z.string().datetime(),
  finalResultStatus: z.enum(["ACCEPTED", "HUMAN_REQUIRED", "REWORK_LIMIT_REACHED"]),
  comment: z.string().trim().optional(),
  requestedChanges: z.array(z.string().trim().min(1)),
  evidenceReviewed: evidenceReviewedSchema,
  approvedEvidence: approvedEvidenceSchema.optional(),
}).superRefine((decision, ctx) => {
  if (decision.decision === "APPROVE") {
    if (decision.finalResultStatus !== "ACCEPTED") {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "APPROVE is allowed only when finalResultStatus is ACCEPTED." });
    }
    if (!decision.approvedEvidence) {
      ctx.addIssue({ code: "custom", path: ["approvedEvidence"], message: "APPROVE requires approved evidence fingerprints." });
    }
    for (const [key, reviewed] of Object.entries(decision.evidenceReviewed)) {
      if (!reviewed) {
        ctx.addIssue({ code: "custom", path: ["evidenceReviewed", key], message: "APPROVE requires all evidence to be reviewed." });
      }
    }
  }
  if (decision.decision === "REQUEST_CHANGES" && decision.requestedChanges.length === 0) {
    ctx.addIssue({ code: "custom", path: ["requestedChanges"], message: "REQUEST_CHANGES requires at least one requested change." });
  }
});

export type ApprovedEvidence = z.infer<typeof approvedEvidenceSchema>;
export type EvidenceReviewed = z.infer<typeof evidenceReviewedSchema>;
export type HumanDecision = z.infer<typeof humanDecisionSchema>;
export type HumanDecisionValue = HumanDecision["decision"];
