import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SessionStatus =
  | "active"
  | "ready_for_review"
  | "committed"
  | "aborted";
export type StepStatus =
  | "open"
  | "running"
  | "awaiting_decision"
  | "accepted"
  | "rejected"
  | "superseded";
export type AttemptStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";
export type DecisionType =
  | "accept"
  | "retry"
  | "revise"
  | "reject"
  | "abort"
  | "commit";
export type DecisionActor = "human" | "system";

export type ArtifactRefs = {
  codingResultPath?: string;
  codingInstructionPath?: string;
  diffPath?: string;
  statusPath?: string;
  taskBriefPath?: string;
  validationReportPath?: string;
  reviewReportPath?: string;
  runtimeDir?: string;
  runtimeManifestPath?: string;
  runtimeStdoutPath?: string;
  runtimeStderrPath?: string;
  runtimeErrorPath?: string;
};

export type SessionGitContext = {
  projectId: string;
  repositoryPath: string;
  remoteName: string;
  remoteUrl?: string;
  baseBranch: string;
  baseCommit: string;
  runBranch: string;
  prTargetBranch: string;
  workspacePath: string;
};

export type Session = {
  schemaVersion: 1;
  sessionId: string;
  runId: string;
  goal: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  branch: string;
  workspacePath?: string;
  git?: SessionGitContext;
  steps: string[];
  activeStepId?: string;
};
export type Step = {
  schemaVersion: 1;
  stepId: string;
  order: number;
  title: string;
  request: string;
  status: StepStatus;
  createdAt: string;
  completedAt?: string;
  attempts: string[];
  decisionIds: string[];
  decisionId?: string;
};
export type Attempt = {
  schemaVersion: 1;
  attemptId: string;
  stepId: string;
  order: number;
  startedAt: string;
  completedAt?: string;
  prompt: string;
  codexThreadId?: string;
  runtimeMode?: string;
  status: AttemptStatus;
  resultStatus?: string;
  artifacts: ArtifactRefs;
  changedFiles: string[];
  validationSummary?: string;
  errorSummary?: string;
};
export type Decision = {
  schemaVersion: 1;
  decisionId: string;
  createdAt: string;
  actor: DecisionActor;
  type: DecisionType;
  reason?: string;
  stepId: string;
  attemptId?: string;
};

function nowIso(now = new Date()): string {
  return now.toISOString();
}
function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
function rel(runDir: string, p: string | undefined): string | undefined {
  return p ? path.relative(runDir, p) || path.basename(p) : undefined;
}
export function stepDir(
  runDir: string,
  step: Pick<Step, "order" | "stepId">,
): string {
  return path.join(
    runDir,
    "steps",
    `${String(step.order).padStart(3, "0")}-${step.stepId}`,
  );
}
export function attemptDir(
  runDir: string,
  step: Pick<Step, "order" | "stepId">,
  attempt: Pick<Attempt, "order" | "attemptId">,
): string {
  return path.join(
    stepDir(runDir, step),
    "attempts",
    `${String(attempt.order).padStart(3, "0")}-${attempt.attemptId}`,
  );
}
async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
export async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}
export async function appendTimelineEvent(
  runDir: string,
  event: {
    type: string;
    sessionId: string;
    stepId?: string;
    attemptId?: string;
    metadata?: Record<string, unknown>;
  },
  timestamp = nowIso(),
): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(
    path.join(runDir, "timeline.jsonl"),
    `${JSON.stringify({ timestamp, event: event.type, sessionId: event.sessionId, stepId: event.stepId, attemptId: event.attemptId, metadata: event.metadata ?? {} })}\n`,
    { encoding: "utf8", flag: "a" },
  );
}
export async function createSession(input: {
  runDir: string;
  runId: string;
  goal: string;
  branch: string;
  workspacePath?: string;
  git?: SessionGitContext;
  requestTitle?: string;
  request?: string;
  now?: Date;
}): Promise<{ session: Session; step: Step }> {
  const createdAt = nowIso(input.now);
  const stepId = newId("step");
  const session: Session = {
    schemaVersion: 1,
    sessionId: input.runId,
    runId: input.runId,
    goal: input.goal,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    branch: input.branch,
    workspacePath: input.workspacePath,
    git: input.git,
    steps: [stepId],
    activeStepId: stepId,
  };
  const step: Step = {
    schemaVersion: 1,
    stepId,
    order: 1,
    title: input.requestTitle ?? "Initial run",
    request: input.request ?? input.goal,
    status: "open",
    createdAt,
    attempts: [],
    decisionIds: [],
  };
  await writeJson(path.join(input.runDir, "session.json"), session);
  await writeJson(path.join(stepDir(input.runDir, step), "step.json"), step);
  await writeFile(
    path.join(stepDir(input.runDir, step), "request.md"),
    `${step.request}\n`,
    "utf8",
  );
  await appendTimelineEvent(
    input.runDir,
    {
      type: "session.created",
      sessionId: session.sessionId,
      metadata: { runId: input.runId, branch: input.branch, baseBranch: input.git?.baseBranch, baseCommit: input.git?.baseCommit, runBranch: input.git?.runBranch, prTargetBranch: input.git?.prTargetBranch },
    },
    createdAt,
  );
  await appendTimelineEvent(
    input.runDir,
    {
      type: "step.created",
      sessionId: session.sessionId,
      stepId,
      metadata: { order: step.order, title: step.title },
    },
    createdAt,
  );
  return { session, step };
}
export async function loadSession(runDir: string): Promise<Session> {
  return readJson<Session>(path.join(runDir, "session.json"));
}
export async function loadStep(runDir: string, stepId?: string): Promise<Step> {
  const session = await loadSession(runDir);
  const id =
    stepId ?? session.activeStepId ?? session.steps[session.steps.length - 1];
  const dirs = await import("node:fs/promises").then((fs) =>
    fs.readdir(path.join(runDir, "steps")),
  );
  const match = dirs.find((d) => d.endsWith(`-${id}`));
  if (!match) throw new Error(`Step not found: ${id}`);
  return readJson<Step>(path.join(runDir, "steps", match, "step.json"));
}
async function persistSession(runDir: string, session: Session): Promise<void> {
  session.updatedAt = nowIso();
  await writeJson(path.join(runDir, "session.json"), session);
}
async function persistStep(runDir: string, step: Step): Promise<void> {
  await writeJson(path.join(stepDir(runDir, step), "step.json"), step);
}

function isClosedStep(status: StepStatus): boolean {
  return (
    status === "accepted" || status === "rejected" || status === "superseded"
  );
}
async function appendStepStatusChanged(
  runDir: string,
  sessionId: string,
  stepId: string,
  from: StepStatus,
  to: StepStatus,
  timestamp = nowIso(),
): Promise<void> {
  if (from !== to)
    await appendTimelineEvent(
      runDir,
      {
        type: "step.status_changed",
        sessionId,
        stepId,
        metadata: { from, to },
      },
      timestamp,
    );
}
export async function createStep(input: {
  runDir: string;
  title: string;
  request: string;
  supersedeCurrent?: boolean;
  now?: Date;
}): Promise<{ session: Session; step: Step }> {
  const session = await loadSession(input.runDir);
  const createdAt = nowIso(input.now);
  if (session.activeStepId) {
    const current = await loadStep(input.runDir, session.activeStepId);
    if (!isClosedStep(current.status)) {
      if (!input.supersedeCurrent)
        throw new Error(
          `Cannot create a new step while active step ${current.stepId} is ${current.status}. Decide it first or use --supersede-current.`,
        );
      const from = current.status;
      current.status = "superseded";
      current.completedAt = createdAt;
      await persistStep(input.runDir, current);
      await appendStepStatusChanged(
        input.runDir,
        session.sessionId,
        current.stepId,
        from,
        current.status,
        createdAt,
      );
      await appendTimelineEvent(
        input.runDir,
        {
          type: "step.completed",
          sessionId: session.sessionId,
          stepId: current.stepId,
          metadata: { status: current.status, reason: "supersede-current" },
        },
        createdAt,
      );
    }
  }
  const stepId = newId("step");
  const step: Step = {
    schemaVersion: 1,
    stepId,
    order: session.steps.length + 1,
    title: input.title,
    request: input.request,
    status: "open",
    createdAt,
    attempts: [],
    decisionIds: [],
  };
  const updatedSession: Session = {
    ...session,
    status: "active",
    steps: [...session.steps, stepId],
    activeStepId: stepId,
  };
  await persistSession(input.runDir, updatedSession);
  await writeJson(path.join(stepDir(input.runDir, step), "step.json"), step);
  await writeFile(
    path.join(stepDir(input.runDir, step), "request.md"),
    `${step.request}\n`,
    "utf8",
  );
  await appendTimelineEvent(
    input.runDir,
    {
      type: "step.created",
      sessionId: session.sessionId,
      stepId,
      metadata: { order: step.order, title: step.title },
    },
    createdAt,
  );
  return { session: updatedSession, step };
}

export async function startAttempt(input: {
  runDir: string;
  step: Step;
  prompt: string;
  runtimeMode?: string;
  now?: Date;
}): Promise<Attempt> {
  const session = await loadSession(input.runDir);

  if (isClosedStep(input.step.status)) {
    throw new Error(
      `Cannot start attempt for ${input.step.status} step ${input.step.stepId}.`,
    );
  }

  if (!session.activeStepId) {
    throw new Error("Cannot start attempt: session has no active step.");
  }

  if (session.activeStepId !== input.step.stepId) {
    throw new Error(
      `Cannot start attempt for inactive step ${input.step.stepId}; active step is ${session.activeStepId}.`,
    );
  }

  if (input.step.status === "running") {
    throw new Error(
      `Cannot start attempt: step ${input.step.stepId} is already running.`,
    );
  }

  const attempt: Attempt = {
    schemaVersion: 1,
    attemptId: newId("attempt"),
    stepId: input.step.stepId,
    order: input.step.attempts.length + 1,
    startedAt: nowIso(input.now),
    prompt: input.prompt,
    runtimeMode: input.runtimeMode,
    status: "running",
    artifacts: {},
    changedFiles: [],
  };

  const from = input.step.status;
  input.step.status = "running";
  input.step.attempts.push(attempt.attemptId);

  await persistStep(input.runDir, input.step);

  await appendStepStatusChanged(
    input.runDir,
    session.sessionId,
    input.step.stepId,
    from,
    input.step.status,
    attempt.startedAt,
  );

  const attemptPath = attemptDir(input.runDir, input.step, attempt);

  await writeJson(path.join(attemptPath, "attempt.json"), attempt);

  // Store the exact rendered prompt without trimming or adding newlines.
  await writeFile(
    path.join(attemptPath, "prompt.md"),
    input.prompt,
    "utf8",
  );

  await appendTimelineEvent(
    input.runDir,
    {
      type: "attempt.started",
      sessionId: session.sessionId,
      stepId: input.step.stepId,
      attemptId: attempt.attemptId,
      metadata: {
        order: attempt.order,
        runtimeMode: attempt.runtimeMode,
      },
    },
    attempt.startedAt,
  );

  return attempt;
}



export async function completeAttempt(input: {
  runDir: string;
  step: Step;
  attempt: Attempt;
  status: AttemptStatus;
  codexThreadId?: string;
  resultStatus?: string;
  changedFiles?: string[];
  validationSummary?: string;
  errorSummary?: string;
  artifacts?: ArtifactRefs;
  workspacePath?: string;
  now?: Date;
}): Promise<Attempt> {
  const completedAt = nowIso(input.now);
  const updated: Attempt = {
    ...input.attempt,
    completedAt,
    status: input.status,
    codexThreadId: input.codexThreadId,
    resultStatus: input.resultStatus,
    changedFiles: input.changedFiles ?? [],
    validationSummary: input.validationSummary,
    errorSummary: input.errorSummary,
    artifacts: input.artifacts ?? input.attempt.artifacts,
  };
  const session = await loadSession(input.runDir);
  const from = input.step.status;
  input.step.status = "awaiting_decision";
  await persistStep(input.runDir, input.step);
  await appendStepStatusChanged(
    input.runDir,
    session.sessionId,
    input.step.stepId,
    from,
    input.step.status,
    completedAt,
  );
  await writeJson(
    path.join(attemptDir(input.runDir, input.step, updated), "attempt.json"),
    updated,
  );
  await persistSession(input.runDir, {
    ...session,
    workspacePath: input.workspacePath ?? session.workspacePath,
  });
  await appendTimelineEvent(
    input.runDir,
    {
      type: input.status === "failed" ? "attempt.failed" : "attempt.completed",
      sessionId: session.sessionId,
      stepId: input.step.stepId,
      attemptId: updated.attemptId,
      metadata: {
        status: updated.status,
        changedFiles: updated.changedFiles,
        validationSummary: updated.validationSummary,
      },
    },
    completedAt,
  );
  return updated;
}
export function artifactRefs(
  runDir: string,
  paths: ArtifactRefs,
): ArtifactRefs {
  return Object.fromEntries(
    Object.entries(paths)
      .map(([k, v]) => [k, rel(runDir, v)])
      .filter(([, v]) => v),
  ) as ArtifactRefs;
}
export async function recordDecision(input: {
  runDir: string;
  step?: Step;
  type: DecisionType;
  reason?: string;
  actor?: DecisionActor;
  attemptId?: string;
  now?: Date;
}): Promise<Decision> {
  const session = await loadSession(input.runDir);
  const step = input.step ?? (await loadStep(input.runDir));
  const createdAt = nowIso(input.now);
  if (isClosedStep(step.status) && input.type !== "commit")
    throw new Error(
      `Cannot record decision for ${step.status} step ${step.stepId}.`,
    );
  const decision: Decision = {
    schemaVersion: 1,
    decisionId: newId("decision"),
    createdAt,
    actor: input.actor ?? "human",
    type: input.type,
    reason: input.reason,
    stepId: step.stepId,
    attemptId: input.attemptId,
  };
  const dir = stepDir(input.runDir, step);
  await writeJson(
    path.join(
      dir,
      "decisions",
      `${decision.createdAt.replace(/[:.]/g, "-")}-${decision.decisionId}.json`,
    ),
    decision,
  );
  await writeJson(path.join(dir, "decision.json"), decision);
  const from = step.status;
  step.decisionIds.push(decision.decisionId);
  step.decisionId = decision.decisionId;
  step.status =
    input.type === "commit" && isClosedStep(step.status)
      ? step.status
      : input.type === "accept" || input.type === "commit"
        ? "accepted"
        : input.type === "reject" || input.type === "abort"
          ? "rejected"
          : input.type === "revise"
            ? "superseded"
            : "open";
  if (["accept", "reject", "abort", "commit", "revise"].includes(input.type))
    step.completedAt = createdAt;
  await persistStep(input.runDir, step);
  await appendStepStatusChanged(
    input.runDir,
    session.sessionId,
    step.stepId,
    from,
    step.status,
    createdAt,
  );
  const nextStatus: SessionStatus =
    input.type === "accept"
      ? "ready_for_review"
      : input.type === "commit"
        ? "committed"
        : input.type === "abort"
          ? "aborted"
          : session.status;
  const nextActiveStepId =
    isClosedStep(step.status) && session.activeStepId === step.stepId
      ? undefined
      : session.activeStepId;
  await persistSession(input.runDir, {
    ...session,
    status: nextStatus,
    activeStepId: nextActiveStepId,
  });
  await appendTimelineEvent(
    input.runDir,
    {
      type: "decision.recorded",
      sessionId: session.sessionId,
      stepId: step.stepId,
      attemptId: input.attemptId,
      metadata: { decision: input.type, actor: decision.actor },
    },
    createdAt,
  );
  if (isClosedStep(step.status))
    await appendTimelineEvent(
      input.runDir,
      {
        type: "step.completed",
        sessionId: session.sessionId,
        stepId: step.stepId,
        metadata: { status: step.status },
      },
      createdAt,
    );
  if (nextStatus !== session.status)
    await appendTimelineEvent(
      input.runDir,
      {
        type: "session.status_changed",
        sessionId: session.sessionId,
        metadata: { from: session.status, to: nextStatus },
      },
      createdAt,
    );
  await writeStepSummary(input.runDir, step, decision);
  return decision;
}
export async function writeStepSummary(
  runDir: string,
  step: Step,
  decision?: Decision,
): Promise<void> {
  const dir = stepDir(runDir, step);
  const attempts = await Promise.all(
    step.attempts.map(async (id) => {
      const attemptDirs = await import("node:fs/promises").then((fs) =>
        fs.readdir(path.join(dir, "attempts")).catch(() => []),
      );
      const match = attemptDirs.find((d) => d.endsWith(`-${id}`));
      return match
        ? readJson<Attempt>(path.join(dir, "attempts", match, "attempt.json"))
        : undefined;
    }),
  );
  const lines = [
    `# Step ${step.order}: ${step.title}`,
    "",
    "## Goal",
    step.request,
    "",
    "## Attempts",
    ...attempts
      .filter(Boolean)
      .map(
        (a) =>
          `- Attempt ${a!.order} (${a!.attemptId}): ${a!.status}; changed files: ${a!.changedFiles.length ? a!.changedFiles.join(", ") : "none"}; validation: ${a!.validationSummary ?? "not recorded"}; error: ${a!.errorSummary ?? "none"}.`,
      ),
    "",
    "## Final decision",
    decision
      ? `${decision.type} by ${decision.actor}${decision.reason ? `: ${decision.reason}` : ""}`
      : "No decision recorded.",
    "",
    "## Known limitations",
    "- Summary is derived from JSON artifacts and timeline; JSON files remain authoritative.",
    "",
  ];
  await writeFile(path.join(dir, "summary.md"), lines.join("\n"), "utf8");
}
export async function recordCommitEvent(
  runDir: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const s = await loadSession(runDir).catch(() => undefined);
  if (!s) return;
  await persistSession(runDir, { ...s, status: "committed" });
  await appendTimelineEvent(runDir, {
    type: "git.commit_created",
    sessionId: s.sessionId,
    metadata,
  });
}
