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
      }),
    },
  });
});
