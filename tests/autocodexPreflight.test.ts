import { describe, expect, it } from "vitest";
import { assertCodexCapabilities, parseCodexAuthStatus, type CliResult, type CodexCli } from "../src/autocodex/codexCliAdapter.js";
import { createCodexChildEnvironment } from "../src/autocodex/runtimePolicy.js";
import { parseTaskPackage } from "../src/autocodex/taskPackage.js";

function fakeCli(login: CliResult, version = "codex 0.2.0"): CodexCli { return { async run(args) { if (args[0] === "--version") return { stdout: version, stderr: "", exitCode: 0 }; if (args[0] === "exec") return { stdout: "usage: codex exec", stderr: "", exitCode: 0 }; return login; } }; }
describe("AutoCodex CLI preflight", () => {
  it("accepts ChatGPT auth and never gives status credential variables", async () => {
    const seen: NodeJS.ProcessEnv[] = []; const cli: CodexCli = { async run(args, options) { seen.push(options?.env ?? {}); return fakeCli({ stdout: "Logged in with ChatGPT", stderr: "", exitCode: 0 }).run(args, options); } };
    await expect(assertCodexCapabilities(cli, "0.1.0", { PATH: "/bin", OPENAI_API_KEY: "secret", CODEX_ACCESS_TOKEN: "secret" })).resolves.toMatchObject({ capabilities: { auth: "chatgpt" } });
    expect(seen.every(env => env.OPENAI_API_KEY === undefined && env.CODEX_ACCESS_TOKEN === undefined)).toBe(true);
  });
  it.each([["API key authentication", "api"], ["Logged in", "unknown"]] as const)("refuses %s auth", async (stdout, expected) => {
    expect(parseCodexAuthStatus({ stdout, stderr: "", exitCode: 0 })).toBe(expected);
    await expect(assertCodexCapabilities(fakeCli({ stdout, stderr: "", exitCode: 0 }))).rejects.toThrow(/ChatGPT/);
  });
  it("refuses an unsupported CLI version", async () => { await expect(assertCodexCapabilities(fakeCli({ stdout: "ChatGPT", stderr: "", exitCode: 0 }, "codex 0.0.9"), "0.1.0")).rejects.toThrow(/Unsupported/); });
  it("uses explicit names-only denied environment metadata", () => {
    const runtime = createCodexChildEnvironment({ PATH: "/bin", OPENAI_API_KEY: "value", ANTHROPIC_API_KEY: "another", SAFE: "no" });
    expect(runtime.env).toEqual({ PATH: "/bin" }); expect(runtime.metadata.deniedNames).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]); expect(JSON.stringify(runtime.metadata)).not.toContain("value");
  });
  it("defaults baseline checks to required passing and permits an explicit exception", () => {
    const base = { schemaVersion: 2 as const, taskId: "task", task: "t", baseCommitSha: "a".repeat(40), steps: [{ id: "step", title: "step" }] };
    expect(parseTaskPackage({ ...base, checks: [{ id: "check", argv: ["npm", "test"] }] }).checks[0]?.mustPassAtBaseline).toBe(true);
    expect(parseTaskPackage({ ...base, checks: [{ id: "known-failure", argv: ["npm", "test"], mustPassAtBaseline: false }] }).checks[0]?.mustPassAtBaseline).toBe(false);
  });
});
