import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { createCodexChildEnvironment } from "./runtimePolicy.js";
import { runProcess, type ProcessRunResult } from "./processRunner.js";
import { codingResultJsonSchema, codingResultSchema, reviewResultJsonSchema, reviewResultSchema, type CodingResult, type ReviewResult } from "./modelSchemas.js";

export type CodexMode = "coding" | "review";
export type CodexArtifactPaths = Readonly<{ directory: string; prompt: string; events: string; stderr: string; final: string; schema: string }>;
export type CodexRunOptions = Readonly<{ executable: string; mode: CodexMode; prompt: string; cwd: string; artifactDirectory: string; timeoutMs: number; maxLogBytes?: number; sourceEnv?: NodeJS.ProcessEnv; extraEnv?: NodeJS.ProcessEnv; sandbox?: string }>;
export type CodexRunResult<T> = Readonly<{ result: T; process: ProcessRunResult; paths: CodexArtifactPaths }>;

export function codexArtifactPaths(directory: string): CodexArtifactPaths { return Object.freeze({ directory, prompt: path.join(directory, "prompt.md"), events: path.join(directory, "events.jsonl"), stderr: path.join(directory, "stderr.log"), final: path.join(directory, "final.json"), schema: path.join(directory, "output-schema.json") }); }
function schemaFor(mode: CodexMode) { return mode === "coding" ? codingResultJsonSchema : reviewResultJsonSchema; }
function validatorFor(mode: CodexMode): z.ZodType<CodingResult | ReviewResult> { return mode === "coding" ? codingResultSchema : reviewResultSchema; }
/** Each call starts a brand-new `codex exec` process; it never resumes a thread/session. */
export async function runCodex<T extends CodingResult | ReviewResult>(options: CodexRunOptions): Promise<CodexRunResult<T>> {
  const paths = codexArtifactPaths(options.artifactDirectory); await mkdir(paths.directory, { recursive: true });
  await Promise.all([writeFile(paths.prompt, options.prompt, "utf8"), writeFile(paths.schema, JSON.stringify(schemaFor(options.mode), null, 2), "utf8")]);
  const runtime = createCodexChildEnvironment(options.sourceEnv, options.extraEnv);
  const argv = ["exec", "--json", "--output-schema", paths.schema, "--output-last-message", paths.final, "--sandbox", options.sandbox ?? (options.mode === "review" ? "read-only" : "workspace-write")];
  const process = await runProcess({ executable: options.executable, argv, stdin: options.prompt, cwd: options.cwd, env: runtime.env, timeoutMs: options.timeoutMs, maxLogBytes: options.maxLogBytes, logPaths: { stdout: paths.events, stderr: paths.stderr } });
  if (process.timedOut) throw new Error(`Codex ${options.mode} session timed out`);
  if (process.exitCode !== 0) throw new Error(`Codex ${options.mode} session failed (exit=${process.exitCode ?? "null"}, signal=${process.signal ?? "none"})`);
  let raw: unknown; try { raw = JSON.parse(await readFile(paths.final, "utf8")); } catch (error) { throw new Error(`Codex ${options.mode} final output is missing or invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  const parsed = validatorFor(options.mode).safeParse(raw); if (!parsed.success) throw new Error(`Codex ${options.mode} final output violates schema: ${parsed.error.message}`);
  return Object.freeze({ result: parsed.data as T, process, paths });
}
export const runCodexSession = runCodex;
