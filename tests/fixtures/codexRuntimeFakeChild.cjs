process.once("message", (request) => {
  process.stdout.write(`fake stdout ${request.mode}\n`);
  process.stderr.write(`fake stderr ${request.mode}\n`);

  if (request.instruction.includes("MODE=TIMEOUT")) {
    setInterval(() => {}, 1000);
    return;
  }
  if (request.instruction.includes("MODE=EXIT")) {
    process.exit(7);
    return;
  }
  if (request.instruction.includes("MODE=WRITE_TEST")) {
    require("fs").writeFileSync(require("path").join(process.cwd(), "AUTOCODEX_RUNTIME_WRITE_TEST.txt"), "runtime write succeeded", "utf8");
  }
  if (request.instruction.includes("MODE=SANDBOX_WRITE_ERROR")) {
    process.send?.({ ok: false, error: { name: "SandboxError", message: "failed to write file: Permission denied (os error 13) while creating docs/AUTOCODEX_TEST.md" } });
    return;
  }
  if (request.instruction.includes("MODE=MALFORMED")) {
    process.send?.({ ok: true, result: { threadId: 123 } });
    return;
  }

  process.send?.({
    ok: true,
    result: {
      threadId: request.mode === "continue" ? request.threadId : "fake-thread",
      finalResponse: JSON.stringify({
        mode: request.mode,
        allowedEnv: Object.keys(process.env).sort(),
        hasSecret: process.env.GITHUB_TOKEN !== undefined || process.env.MY_PRIVATE_API_KEY !== undefined,
        home: process.env.HOME,
        tmpdir: process.env.TMPDIR,
        gitConfigGlobal: process.env.GIT_CONFIG_GLOBAL,
        cwd: process.cwd(),
        sandboxMode: request.sandboxMode,
        approvalPolicy: request.approvalPolicy,
      }),
      diagnostics: {
        sdkOptions: { workingDirectory: request.workingDirectory, sandboxMode: request.sandboxMode, approvalPolicy: request.approvalPolicy },
        sandboxModeRequested: request.sandboxMode,
        sandboxModeEffective: "unconfirmed",
        approvalPolicy: request.approvalPolicy,
        childCwd: process.cwd(),
      },
    },
  });
});
