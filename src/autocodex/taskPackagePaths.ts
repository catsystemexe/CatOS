import { realpath } from "node:fs/promises";
import path from "node:path";

/** Paths in a v2 package are always package-relative POSIX-like paths. */
export function assertPackageRelativePath(value: string): string {
  if (!value || typeof value !== "string" || value.includes("\0")) throw new Error("Package path must be a non-empty string.");
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) throw new Error(`Package path must be relative: ${value}`);
  const normalized = path.normalize(value);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) throw new Error(`Package path escapes its package: ${value}`);
  return normalized;
}

export function packagePath(packageDir: string, relativePath: string): string {
  return path.resolve(packageDir, assertPackageRelativePath(relativePath));
}

/** Resolves symlinks and rejects a target outside packageDir. */
export async function realpathWithinPackage(packageDir: string, relativePath: string): Promise<string> {
  const root = await realpath(packageDir);
  const target = await realpath(packagePath(root, relativePath));
  const relative = path.relative(root, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Package file resolves outside package: ${relativePath}`);
  }
  return target;
}

export const resolvePackageFile = realpathWithinPackage;
