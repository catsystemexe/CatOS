import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCodex } from "../src/autocodex/codexRunner.js";
const fixture = path.resolve("tests/fixtures/fakeCodexCli.cjs");
const base = async (extra: NodeJS.ProcessEnv = {}) => runCodex({ executable: fixture, mode: "coding", prompt: "hello", cwd: process.cwd(), artifactDirectory: await mkdtemp(path.join(os.tmpdir(), "catos-codex-")), timeoutMs: 2_000, sourceEnv: { ...process.env, OPENAI_API_KEY: "must-not-leak" }, extraEnv: extra });
describe("Codex v2 runner", () => {
  it("uses fixed argv, stdin, and a credential-free child environment", async () => { const capture = path.join(await mkdtemp(path.join(os.tmpdir(), "catos-capture-")), "capture.json"); await base({ FAKE_CODEX_CAPTURE: capture }); const got = JSON.parse(await readFile(capture, "utf8")); expect(got.args).toContain("exec"); expect(got.args).toContain("--json"); expect(got.args).not.toContain("resume"); expect(got.stdin).toBe("hello"); expect(got.env.OPENAI_API_KEY).toBeUndefined(); });
  it("rejects invalid final output", async () => { await expect(base({ FAKE_CODEX_MODE: "invalid" })).rejects.toThrow(/final output/); });
  it("times out and retains bounded logs", async () => { await expect(base({ FAKE_CODEX_MODE: "timeout" })).rejects.toThrow(/timed out/); });
  it("marks truncation in persisted stderr", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "catos-codex-")); await runCodex({ executable: fixture, mode: "coding", prompt: "x", cwd: process.cwd(), artifactDirectory: dir, timeoutMs: 2_000, maxLogBytes: 10, sourceEnv: process.env, extraEnv: { FAKE_CODEX_MODE: "large" } }); expect(await readFile(path.join(dir, "stderr.log"), "utf8")).toContain("truncated"); });
});
