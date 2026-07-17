import type { CheckRunReport } from "./checks.js";
import type { ChangeValidationReport } from "./changeValidation.js";
import type { ReviewResult } from "./modelSchemas.js";

export type ReworkContext = Readonly<{
  schemaVersion: 2;
  attemptNumber: number;
  reason: "CHECKS" | "CHANGE_VALIDATION" | "REVIEW";
  requiredChanges: readonly { severity: "critical" | "major" | "minor"; criterionId: string; description: string; evidence: string }[];
  validationViolations: readonly string[];
  blockingTests: readonly string[];
  priorCommit?: string;
}>;

/** Build only explicit, auditable guidance for a brand-new Coding process. */
export function createReworkContext(input: { attemptNumber: number; review?: ReviewResult; validation?: ChangeValidationReport; checks?: CheckRunReport; priorCommit?: string }): ReworkContext {
  const requiredChanges = input.review?.requiredChanges ?? [];
  const validationViolations = input.validation?.violations ?? [];
  const blockingTests = (input.checks?.results ?? []).filter((result) => result.blocking && result.status !== "PASS").map((result) => `${result.id}: ${result.status}`);
  const reason = requiredChanges.length ? "REVIEW" : validationViolations.length ? "CHANGE_VALIDATION" : "CHECKS";
  return Object.freeze({ schemaVersion: 2, attemptNumber: input.attemptNumber, reason, requiredChanges: Object.freeze(requiredChanges.map((change) => Object.freeze({ ...change }))), validationViolations: Object.freeze([...validationViolations]), blockingTests: Object.freeze(blockingTests), ...(input.priorCommit ? { priorCommit: input.priorCommit } : {}) });
}

export const buildReworkContext = createReworkContext;
