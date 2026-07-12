import { writeFile } from "node:fs/promises";
import path from "node:path";
import { taskBriefSchema, type TaskBrief } from "../schemas/taskBrief.js";

export type TaskAnalystProvider = {
  analyze(input: TaskAnalystProviderInput): Promise<unknown>;
};

export type TaskAnalystProviderInput = {
  goal: string;
  projectId: string;
  retry: boolean;
  previousInvalidOutput?: unknown;
  validationError?: string;
};

export type AnalyzeTaskOptions = {
  provider?: TaskAnalystProvider;
  apiKey?: string;
  model?: string;
};

export type AnalyzeTaskResult = {
  taskBrief: TaskBrief;
  attempts: number;
};

export class TaskBriefValidationError extends Error {
  constructor(message: string, readonly attempts: number) {
    super(message);
    this.name = "TaskBriefValidationError";
  }
}

export async function analyzeTaskBrief(goal: string, projectId: string, options: AnalyzeTaskOptions = {}): Promise<AnalyzeTaskResult> {
  const provider = options.provider ?? createOpenAITaskAnalystProvider({ apiKey: options.apiKey, model: options.model });
  let previousInvalidOutput: unknown;
  let validationError: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const output = await provider.analyze({
      goal,
      projectId,
      retry: attempt === 2,
      previousInvalidOutput,
      validationError,
    });
    const parsed = taskBriefSchema.safeParse(output);

    if (parsed.success) {
      return { taskBrief: parsed.data, attempts: attempt };
    }

    previousInvalidOutput = output;
    validationError = parsed.error.message;
  }

  throw new TaskBriefValidationError(`Task Analyst returned invalid TaskBrief after 2 attempts: ${validationError ?? "unknown validation error"}`, 2);
}

export async function writeTaskBrief(runDir: string, taskBrief: TaskBrief): Promise<string> {
  const taskBriefPath = path.join(runDir, "task-brief.json");
  await writeFile(taskBriefPath, `${JSON.stringify(taskBrief, null, 2)}\n`, "utf8");
  return taskBriefPath;
}

export function createOpenAITaskAnalystProvider(options: { apiKey?: string; model?: string } = {}): TaskAnalystProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Chybí OPENAI_API_KEY pro Task Analyst agenta.");
  }

  return {
    async analyze(input: TaskAnalystProviderInput): Promise<unknown> {
      const { Agent, run, setDefaultOpenAIKey } = await import("@openai/agents");
      setDefaultOpenAIKey(apiKey);

      const agent = new Agent({
        name: "CatOS Task Analyst",
        model: options.model ?? process.env.CATOS_TASK_ANALYST_MODEL ?? "gpt-5.5",
        instructions: [
          "Convert a human software task into a concise TaskBrief for a later Codex worker.",
          "Do not call tools. You have no shell access and no file editing capability.",
          "Keep non-goals explicit. The codexInstruction must be directly actionable and must not ask Codex to do review, rework loops, event logs, databases, Temporal, LangGraph, or GitHub automation unless the user explicitly requested them.",
          "Set riskLevel to trivial only for tiny safe edits, standard for ordinary code changes, and critical for destructive, security-sensitive, data-loss, deployment, or large architectural changes.",
        ].join("\n"),
        tools: [],
        outputType: taskBriefSchema,
      });

      const prompt = input.retry
        ? `The previous TaskBrief was invalid. Validation error: ${input.validationError}\nPrevious invalid output: ${JSON.stringify(input.previousInvalidOutput)}\nReturn a corrected TaskBrief for project ${input.projectId} and goal:\n${input.goal}`
        : `Create a TaskBrief for project ${input.projectId} and goal:\n${input.goal}`;

      const result = await run(agent, prompt);
      return result.finalOutput;
    },
  };
}
