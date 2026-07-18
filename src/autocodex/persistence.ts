import { open, mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EVENTS_FILE, STATE_FILE } from "./artifactPaths.js";
import type { RunState } from "./state.js";
import { requiresExplicitResume } from "./state.js";

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, filePath); // same directory guarantees same filesystem and atomic replacement
}
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
export async function atomicWriteText(filePath: string, content: string): Promise<void> {
  await atomicWrite(filePath, content);
}
export async function readCompleteJson<T>(filePath: string): Promise<T> {
  try { return JSON.parse(await readFile(filePath, "utf8")) as T; }
  catch (error) { throw new Error(`Incomplete or invalid persisted JSON at ${filePath}: ${error instanceof Error ? error.message : String(error)}`); }
}
export async function writeRunState(packageDir: string, state: RunState): Promise<void> { await atomicWriteJson(path.join(packageDir, STATE_FILE), state); }
export async function readRunState(packageDir: string): Promise<RunState> { return readCompleteJson<RunState>(path.join(packageDir, STATE_FILE)); }
export async function resumeRunState(packageDir: string): Promise<RunState> {
  const state = await readRunState(packageDir);
  if (requiresExplicitResume(state)) throw new Error("Automatic resume is forbidden; an explicit operator transition is required.");
  return state;
}
export type EventRecord = { sequence: number; timestamp: string; type: string; data?: Record<string, unknown> };
/** Appends one durable event. Callers must hold the package lock to preserve global sequencing. */
export async function appendEvent(packageDir: string, event: Omit<EventRecord, "sequence" | "timestamp"> & Partial<Pick<EventRecord, "timestamp">>): Promise<EventRecord> {
  await mkdir(packageDir, { recursive: true }); const file = path.join(packageDir, EVENTS_FILE);
  let sequence = 1;
  try { const content = await readFile(file, "utf8"); for (const line of content.trim().split("\n")) { if (!line) continue; const previous = JSON.parse(line) as EventRecord; if (!Number.isInteger(previous.sequence) || previous.sequence !== sequence) throw new Error("events.jsonl has non-monotonic sequence"); sequence += 1; } } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const record: EventRecord = { sequence, timestamp: event.timestamp ?? new Date().toISOString(), type: event.type, ...(event.data ? { data: event.data } : {}) };
  const handle = await open(file, "a", 0o600); try { await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  return record;
}
