import os from "node:os";
import path from "node:path";

export function resolveWorkspaceRoot(configuredWorkspaceRoot?: string, envWorkspaceRoot = process.env.CATOS_WORKSPACE_ROOT): string {
  const candidate = configuredWorkspaceRoot && configuredWorkspaceRoot.trim().length > 0
    ? configuredWorkspaceRoot
    : envWorkspaceRoot && envWorkspaceRoot.trim().length > 0
      ? envWorkspaceRoot
      : path.join(os.tmpdir(), "catos-workspaces");
  return path.resolve(candidate);
}
