import type { CodexRuntimeRequest, CodexRuntimeResult, SandboxMode } from "./codingWorker.js";

type CodexThread = {
  id?: string;
  threadId?: string;
  run(instruction: string): Promise<unknown>;
};

type CodexClient = {
  startThread(options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }): CodexThread;
  resumeThread?: (threadId: string, options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }) => CodexThread;
  continueThread?: (threadId: string, options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }) => CodexThread;
};

type CodexConstructor = new () => CodexClient;

type CodexTurn = {
  finalResponse?: string;
  response?: string;
  text?: string;
};

type RuntimeSuccess = {
  ok: true;
  result: CodexRuntimeResult;
};

type RuntimeFailure = {
  ok: false;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
};

function stringifyCodexTurn(turn: unknown): string {
  if (typeof turn === "string") return turn;
  if (turn && typeof turn === "object") {
    const candidate = turn as CodexTurn;
    return candidate.finalResponse ?? candidate.response ?? candidate.text ?? JSON.stringify(turn);
  }
  return String(turn ?? "");
}

function serializeError(error: unknown): RuntimeFailure["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return { name: "Error", message: String(error ?? "unknown error") };
}

async function loadCodex(): Promise<CodexClient> {
  // The official dependency is installed by npm in environments where registry access allows it.
  // @ts-ignore The package may be unavailable in offline/firewalled test environments; do not add a local shim.
  const sdk: { Codex: CodexConstructor } = await import("@openai/codex-sdk");
  return new sdk.Codex();
}

async function runCodex(request: CodexRuntimeRequest): Promise<CodexRuntimeResult> {
  const codex = await loadCodex();
  const options = {
    workingDirectory: request.workingDirectory,
    sandboxMode: request.sandboxMode,
    ...(request.model ? { model: request.model } : {}),
  };
  const thread = request.mode === "start"
    ? codex.startThread(options)
    : (() => {
        const resume = codex.resumeThread ?? codex.continueThread;
        if (!resume) throw new Error("Codex SDK client does not expose resumeThread/continueThread for rework continuation.");
        return resume.call(codex, request.threadId, options);
      })();
  const turn = await thread.run(request.instruction);
  return {
    threadId: thread.id ?? thread.threadId ?? (request.mode === "continue" ? request.threadId : "unknown"),
    finalResponse: stringifyCodexTurn(turn),
  };
}

process.once("message", (message: unknown) => {
  void (async () => {
    try {
      const result = await runCodex(message as CodexRuntimeRequest);
      process.send?.({ ok: true, result } satisfies RuntimeSuccess);
    } catch (error) {
      process.send?.({ ok: false, error: serializeError(error) } satisfies RuntimeFailure);
      process.exitCode = 1;
    }
  })();
});
