import { z } from "zod";

const text = z.string().trim().min(1).max(20_000);
const path = z.string().min(1).max(1_024).refine((value) => !value.includes("\0"), "path must not contain NUL");

/** The only model-authored payload accepted from a Coding session. */
export const codingResultSchema = z.object({
  status: z.enum(["COMPLETED", "BLOCKED"]),
  summary: text,
  changes: z.array(z.object({ path, description: text }).strict()).max(1_000),
  checksRunByAgent: z.array(text).max(100),
  remainingConcerns: z.array(text).max(100),
}).strict();
export type CodingResult = z.infer<typeof codingResultSchema>;

export const reviewRequiredChangeSchema = z.object({
  severity: z.enum(["critical", "major", "minor"]),
  criterionId: z.string().trim().min(1).max(256),
  description: text,
  evidence: text,
}).strict();
/** The only model-authored payload accepted from a Review session. */
export const reviewResultSchema = z.object({
  decision: z.enum(["APPROVE", "REWORK", "BLOCKED"]),
  summary: text,
  requiredChanges: z.array(reviewRequiredChangeSchema).max(100),
  nonBlockingNotes: z.array(text).max(100),
  /** A BLOCKED decision must name an external dependency or a human decision. */
  blocker: text.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "APPROVE" && value.requiredChanges.length) ctx.addIssue({ code: "custom", path: ["requiredChanges"], message: "APPROVE must not include required changes" });
  if (value.decision === "REWORK" && !value.requiredChanges.length) ctx.addIssue({ code: "custom", path: ["requiredChanges"], message: "REWORK requires at least one required change" });
  if (value.decision === "BLOCKED" && !value.blocker) ctx.addIssue({ code: "custom", path: ["blocker"], message: "BLOCKED requires an explicit external or human blocker" });
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const codingResultJsonSchema = z.toJSONSchema(codingResultSchema, { target: "draft-2020-12" });
export const reviewResultJsonSchema = z.toJSONSchema(reviewResultSchema, { target: "draft-2020-12" });
