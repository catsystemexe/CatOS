import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { LOCK_FILE } from "./artifactPaths.js";

export class LockError extends Error { constructor(public readonly lockPath: string) { super(`Lock is already held: ${lockPath}`); this.name = "LockError"; } }
export type HeldLock = { path: string; release(): Promise<void> };
async function acquire(lockPath: string): Promise<HeldLock> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LockError(lockPath); throw error; }
  try { await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
  let released = false;
  return { path: lockPath, async release() { if (!released) { released = true; await unlink(lockPath); } } };
}
export function acquireTaskLock(packageDir: string): Promise<HeldLock> { return acquire(path.join(packageDir, LOCK_FILE)); }
/** Repository-wide lock guards shared worktree operations independently of a task package. */
export function acquireRepositoryLock(repositoryDir: string): Promise<HeldLock> { return acquire(path.join(repositoryDir, ".catos.repository.lock")); }
export async function withTaskLock<T>(packageDir: string, operation: () => Promise<T>): Promise<T> { const lock = await acquireTaskLock(packageDir); try { return await operation(); } finally { await lock.release(); } }
