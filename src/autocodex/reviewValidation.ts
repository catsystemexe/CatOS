import { reviewResultSchema, type ReviewResult } from "./modelSchemas.js";

export class ReviewValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ReviewValidationError"; }
}

/**
 * The structured schema establishes the shape; this boundary establishes the
 * coordinator policy.  In particular, a model may not turn uncertainty or a
 * missing implementation detail into a terminal BLOCKED result.
 */
export function validateReviewResult(value: unknown): ReviewResult {
  const parsed = reviewResultSchema.safeParse(value);
  if (!parsed.success) throw new ReviewValidationError(`Invalid Review result: ${parsed.error.message}`);
  const result = parsed.data;
  if (result.decision === "APPROVE" && result.requiredChanges.length !== 0) throw new ReviewValidationError("APPROVE requires empty findings.");
  if (result.decision === "REWORK" && !result.requiredChanges.some((change) => change.description.trim() && change.evidence.trim() && change.criterionId.trim())) throw new ReviewValidationError("REWORK requires at least one concrete required change.");
  if (result.decision === "BLOCKED") {
    const blocker = result.blocker!.trim();
    if (!/(?:human|user|operator|approval|decision|external|third.party|vendor|service|access|credential|dependency|repository owner)/i.test(blocker)) {
      throw new ReviewValidationError("BLOCKED requires an explicit external or human blocker, not an implementation concern.");
    }
  }
  return Object.freeze({ ...result, requiredChanges: Object.freeze([...result.requiredChanges]), nonBlockingNotes: Object.freeze([...result.nonBlockingNotes]) });
}

export const assertValidReviewResult = validateReviewResult;
