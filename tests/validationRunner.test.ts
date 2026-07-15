import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  ShellValidationRunner,
  buildValidationCommands,
  writeValidationReport,
  type ValidationCommand,
  type ValidationReport,
} from "../src/validationRunner.js";

const execFileAsync = promisify(execFile);

async function workspace(): Promise<string> {
  const ws = await mkdtemp(
    path.join(os.tmpdir(), "catos-validation-workspace-"),
  );
  await execFileAsync("git", ["init", "-b", "main"], { cwd: ws });
  await execFileAsync("git", ["config", "user.email", "catos@example.test"], {
    cwd: ws,
  });
  await execFileAsync("git", ["config", "user.name", "CatOS Test"], {
    cwd: ws,
  });
  await writeFile(path.join(ws, ".gitkeep"), "", "utf8");
  await execFileAsync("git", ["add", ".gitkeep"], { cwd: ws });
  await execFileAsync("git", ["commit", "-m", "initial"], { cwd: ws });
  return ws;
}

function nodeCommand(source: string): string {
  return `"${process.execPath}" -e ${JSON.stringify(source)}`;
}

function command(
  name: string,
  source: string,
  timeoutMs = 5_000,
): ValidationCommand {
  return { name, command: nodeCommand(source), required: true, timeoutMs };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const missingCommand: ValidationCommand = {
  name: "missing",
  command: "__catos_missing_executable__",
  required: true,
  timeoutMs: 5_000,
};

describe("ShellValidationRunner", () => {
  it("reports PASS for a command exiting with code 0", async () => {
    const runner = new ShellValidationRunner();
    const report = await runner.run({
      workspacePath: await workspace(),
      commands: [command("ok", "console.log('ok')")],
    });
    expect(report.status).toBe("PASS");
    expect(report.results[0]?.status).toBe("PASS");
    expect(report.results[0]?.exitCode).toBe(0);
    expect(report.results[0]?.stdout).toContain("ok");
  });

  it("reports FAIL for a non-zero exit code", async () => {
    const runner = new ShellValidationRunner();
    const report = await runner.run({
      workspacePath: await workspace(),
      commands: [command("fail", "process.exit(3)")],
    });
    expect(report.status).toBe("FAIL");
    expect(report.results[0]?.status).toBe("FAIL");
    expect(report.results[0]?.exitCode).toBe(3);
  });

  it("reports BLOCKED for a missing executable", async () => {
    const runner = new ShellValidationRunner();
    const report = await runner.run({
      workspacePath: await workspace(),
      commands: [missingCommand],
    });
    expect(report.status).toBe("BLOCKED");
    expect(report.results[0]?.status).toBe("BLOCKED");
  });

  it("reports BLOCKED for a timeout", async () => {
    const runner = new ShellValidationRunner();
    const started = Date.now();
    const report = await runner.run({
      workspacePath: await workspace(),
      commands: [command("timeout", "setTimeout(() => {}, 5000)", 100)],
    });
    const elapsedMs = Date.now() - started;

    expect(report.status).toBe("BLOCKED");
    expect(report.results[0]?.status).toBe("BLOCKED");
    expect(report.results[0]?.timedOut).toBe(true);
    expect(report.results[0]?.durationMs).toBeGreaterThanOrEqual(90);
    expect(report.results[0]?.durationMs).toBeLessThan(1_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it("continues after a timeout and kills the timed-out shell child process", async () => {
    const ws = await workspace();
    const delayedFile = path.join(ws, "delayed-child-output.txt");
    const runner = new ShellValidationRunner();
    const started = Date.now();

    const report = await runner.run({
      workspacePath: ws,
      commands: [
        command(
          "timeout",
          `const fs = require('node:fs'); setTimeout(() => fs.writeFileSync(${JSON.stringify(delayedFile)}, 'late'), 2000); setTimeout(() => {}, 5000);`,
          100,
        ),
        command("second", "console.log('second passed')", 1_000),
      ],
    });
    const elapsedMs = Date.now() - started;

    expect(report.status).toBe("BLOCKED");
    expect(report.results.map((result) => result.status)).toEqual([
      "BLOCKED",
      "PASS",
    ]);
    expect(report.results[0]?.timedOut).toBe(true);
    expect(report.results[1]?.stdout).toContain("second passed");
    expect(elapsedMs).toBeLessThan(1_000);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await exists(delayedFile)).toBe(false);
  });

  it("continues running commands after an earlier failure", async () => {
    const runner = new ShellValidationRunner();
    const report = await runner.run({
      workspacePath: await workspace(),
      commands: [
        command("first", "process.exit(1)"),
        command("second", "console.log('continued')"),
      ],
    });
    expect(report.status).toBe("FAIL");
    expect(report.results.map((result) => result.status)).toEqual([
      "FAIL",
      "PASS",
    ]);
    expect(report.results[1]?.stdout).toContain("continued");
  });

  it("computes overall PASS, FAIL, and BLOCKED statuses", async () => {
    const runner = new ShellValidationRunner();
    const ws = await workspace();
    await expect(
      runner.run({
        workspacePath: ws,
        commands: [command("ok", "process.exit(0)")],
      }),
    ).resolves.toMatchObject({ status: "PASS" });
    await expect(
      runner.run({
        workspacePath: ws,
        commands: [
          command("bad", "process.exit(2)"),
          command("ok", "process.exit(0)"),
        ],
      }),
    ).resolves.toMatchObject({ status: "FAIL" });
    await expect(
      runner.run({
        workspacePath: ws,
        commands: [command("bad", "process.exit(2)"), missingCommand],
      }),
    ).resolves.toMatchObject({ status: "FAIL" });
    await expect(
      runner.run({
        workspacePath: ws,
        commands: [missingCommand, command("ok", "process.exit(0)")],
      }),
    ).resolves.toMatchObject({ status: "BLOCKED" });
  });

  it("runs commands with cwd set to the worktree", async () => {
    const ws = await workspace();
    await writeFile(path.join(ws, "marker.txt"), "worktree", "utf8");
    const runner = new ShellValidationRunner();
    const report = await runner.run({
      workspacePath: ws,
      commands: [
        command(
          "cwd",
          "const fs=require('node:fs'); console.log(process.cwd()); if (!fs.existsSync('marker.txt')) process.exit(4);",
        ),
      ],
    });
    expect(report.status).toBe("PASS");
    expect(report.results[0]?.stdout).toContain(ws);
  });

  it("returns BLOCKED when Git top-level does not exactly match workspace path", async () => {
    const parent = await workspace();
    const child = path.join(parent, "nested");
    await mkdir(child);
    const runner = new ShellValidationRunner({
      catosRoot: await mkdtemp(
        path.join(os.tmpdir(), "catos-validation-catos-root-"),
      ),
    });
    const report = await runner.run({
      workspacePath: child,
      commands: [command("ok", "process.exit(0)")],
    });
    expect(report.status).toBe("BLOCKED");
    expect(report.results[0]?.name).toBe("preflight");
    expect(report.results[0]?.stderr).toContain("Git top-level mismatch");
  });

  it("does not run parent package scripts when target workspace has no package.json", async () => {
    const orchestratorRoot = await mkdtemp(
      path.join(os.tmpdir(), "catos-validation-orchestrator-"),
    );
    await writeFile(
      path.join(orchestratorRoot, "package.json"),
      JSON.stringify({ scripts: { typecheck: 'node -e "process.exit(0)"' } }),
      "utf8",
    );
    const target = await workspace();
    const runner = new ShellValidationRunner({ catosRoot: orchestratorRoot });
    const report = await runner.run({
      workspacePath: target,
      commands: [
        {
          name: "typecheck",
          command: "npm run typecheck",
          required: true,
          timeoutMs: 10_000,
        },
      ],
    });
    expect(report.status).not.toBe("PASS");
    expect(["FAIL", "BLOCKED"]).toContain(report.status);
    expect(report.results[0]?.stdout).not.toContain("catos@0.1.0");
  });

  it("returns BLOCKED instead of false PASS for a demo workspace inside CatOS root", async () => {
    const catosRoot = await mkdtemp(
      path.join(os.tmpdir(), "catos-validation-catos-root-"),
    );
    const ws = path.join(catosRoot, "runs", "demo", "workspace");
    await mkdir(ws, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: ws });
    const runner = new ShellValidationRunner({ catosRoot });
    const report = await runner.run({
      workspacePath: ws,
      commands: [
        {
          name: "typecheck",
          command: "npm run typecheck",
          required: true,
          timeoutMs: 10_000,
        },
      ],
    });
    expect(report.status).toBe("BLOCKED");
    expect(report.results[0]?.name).toBe("preflight");
  });

  it("writes validation-report.json", async () => {
    const runDir = await mkdtemp(
      path.join(os.tmpdir(), "catos-validation-run-"),
    );
    const report: ValidationReport = {
      schemaVersion: 1,
      status: "PASS",
      workspacePath: runDir,
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      results: [],
    };
    const reportPath = await writeValidationReport(runDir, report);
    expect(reportPath).toBe(path.join(runDir, "validation-report.json"));
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toEqual(report);
  });

  it("builds default required typecheck, test, and build commands", () => {
    expect(
      buildValidationCommands(
        { typecheck: "a", test: "b", build: "c" },
        { timeoutMs: 123 },
      ),
    ).toEqual([
      { name: "typecheck", command: "a", required: true, timeoutMs: 123 },
      { name: "test", command: "b", required: true, timeoutMs: 123 },
      { name: "build", command: "c", required: true, timeoutMs: 123 },
    ]);
  });
});

it("reports configured skips as SKIPPED without executing placeholder commands", async () => {
  const runner = new ShellValidationRunner();
  const report = await runner.run({
    workspacePath: await workspace(),
    commands: [
      {
        name: "typecheck",
        command: "catos:skip:no npm script named typecheck",
        required: true,
        timeoutMs: 1000,
      },
    ],
  });
  expect(report.status).toBe("SKIPPED");
  expect(report.results[0]?.status).toBe("SKIPPED");
  expect(report.results[0]?.command).toBe(
    "catos:skip:no npm script named typecheck",
  );
  expect(JSON.stringify(report)).not.toContain("${name}");
  expect(report.results[0]?.exitCode).toBeNull();
});

it("maps PASS + SKIPPED to PASS, FAIL dominates SKIPPED, and BLOCKED dominates SKIPPED without FAIL", async () => {
  const runner = new ShellValidationRunner();
  const skip: ValidationCommand = {
    name: "skip",
    command: "catos:skip:no npm script",
    required: true,
    timeoutMs: 1000,
  };
  await expect(
    runner.run({
      workspacePath: await workspace(),
      commands: [command("ok", "process.exit(0)"), skip],
    }),
  ).resolves.toMatchObject({ status: "PASS" });
  await expect(
    runner.run({
      workspacePath: await workspace(),
      commands: [command("fail", "process.exit(1)"), skip],
    }),
  ).resolves.toMatchObject({ status: "FAIL" });
  await expect(
    runner.run({
      workspacePath: await workspace(),
      commands: [missingCommand, skip],
    }),
  ).resolves.toMatchObject({ status: "BLOCKED" });
});
