import type { TaskPackage } from "./taskPackage.js";
import { CODING_TEMPLATE_VERSION, codingTemplate } from "./templates/coding.v1.js";
import { REVIEW_TEMPLATE_VERSION, reviewTemplate } from "./templates/review.v1.js";

export type FrozenTaskPackage = TaskPackage;
export type FeederStep = Readonly<{ id: string; title: string; [key: string]: unknown }>;
export type FeederAttempt = Readonly<{ id?: string; attemptId?: string; number?: number; [key: string]: unknown }>;
export type ReworkContext = Readonly<Record<string, unknown>> | null;
export type RenderedPrompt = Readonly<{ templateVersion: string; prompt: string }>;

function stable(value: unknown): string { return JSON.stringify(value, null, 2); }
function frozen(value: object, name: string): void { if (!Object.isFrozen(value)) throw new Error(`${name} must be frozen before rendering a model prompt`); }
function render(template: string, taskPackage: FrozenTaskPackage, step: FeederStep, attempt: FeederAttempt, reworkContext: ReworkContext): string {
  frozen(taskPackage, "Task Package"); frozen(step, "Step"); frozen(attempt, "Attempt"); if (reworkContext) frozen(reworkContext, "Rework context");
  return template.replace("{{taskPackage}}", stable(taskPackage)).replace("{{step}}", stable(step)).replace("{{attempt}}", stable(attempt)).replace("{{reworkContext}}", stable(reworkContext));
}
/** Deterministically renders a Coding prompt from frozen explicit inputs only. */
export function createCodingPrompt(taskPackage: FrozenTaskPackage, step: FeederStep, attempt: FeederAttempt, reworkContext: ReworkContext = null): RenderedPrompt { return Object.freeze({ templateVersion: CODING_TEMPLATE_VERSION, prompt: render(codingTemplate, taskPackage, step, attempt, reworkContext) }); }
/** Deterministically renders a Review prompt from frozen explicit inputs only. */
export function createReviewPrompt(taskPackage: FrozenTaskPackage, step: FeederStep, attempt: FeederAttempt, reworkContext: ReworkContext = null): RenderedPrompt { return Object.freeze({ templateVersion: REVIEW_TEMPLATE_VERSION, prompt: render(reviewTemplate, taskPackage, step, attempt, reworkContext) }); }
export const buildCodingPrompt = createCodingPrompt;
export const buildReviewPrompt = createReviewPrompt;
