export const RUN_STATUSES = ["PENDING", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export const STEP_STATUSES = ["PENDING", "RUNNING", "WAITING", "SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"] as const;
export const ATTEMPT_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"] as const;
export const REASON_CODES = ["NONE", "STARTED", "CHECK_FAILED", "VALIDATION_FAILED", "TIMEOUT", "CANCELLED", "HUMAN_REQUIRED", "DEPENDENCY_FAILED", "INCOMPLETE_STATE", "LOCKED", "INVALID_TRANSITION", "CRASH_RECOVERY_REQUIRED"] as const;
export type RunStatus = typeof RUN_STATUSES[number];
export type StepStatus = typeof STEP_STATUSES[number];
export type AttemptStatus = typeof ATTEMPT_STATUSES[number];
export type ReasonCode = typeof REASON_CODES[number];
export type StateStatus = RunStatus | StepStatus | AttemptStatus;

const transitions: Record<StateStatus, readonly StateStatus[]> = {
  PENDING: ["RUNNING", "CANCELLED", "SKIPPED"], RUNNING: ["WAITING", "SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED"], WAITING: ["RUNNING", "FAILED", "CANCELLED"], SUCCEEDED: [], FAILED: [], TIMED_OUT: [], CANCELLED: [], SKIPPED: [],
};
export function canTransition(from: StateStatus, to: StateStatus): boolean { return transitions[from]?.includes(to) ?? false; }
export function assertTransition(from: StateStatus, to: StateStatus, reason: ReasonCode = "NONE"): void {
  if (!canTransition(from, to)) throw new Error(`Invalid state transition ${from} -> ${to} (${reason}).`);
}
export type AttemptState = { attemptId: string; status: AttemptStatus; reasonCode: ReasonCode; startedAt?: string; completedAt?: string };
export type StepState = { stepId: string; status: StepStatus; reasonCode: ReasonCode; attemptIds: string[]; activeAttemptId?: string };
export type RunState = { schemaVersion: 2; taskId: string; status: RunStatus; reasonCode: ReasonCode; steps: StepState[]; attempts: AttemptState[]; createdAt: string; updatedAt: string };
export function transitionState<T extends { status: StateStatus; reasonCode: ReasonCode }>(state: T, status: T["status"], reasonCode: ReasonCode): T {
  assertTransition(state.status, status, reasonCode); return { ...state, status, reasonCode };
}
/** A persisted RUNNING/WAITING state is deliberately non-resumable without an explicit operator action. */
export function requiresExplicitResume(state: Pick<RunState, "status">): boolean { return state.status === "RUNNING" || state.status === "WAITING"; }
