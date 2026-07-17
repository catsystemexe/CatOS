import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { RUN_ARTIFACT_PATHS, runArtifactPath } from "./artifactPaths.js";
import { atomicWriteJson } from "./persistence.js";

export type ArtifactManifest = Readonly<{ schemaVersion: 1; algorithm: "sha256"; files: readonly Readonly<{ path: string; sha256: string; bytes: number }>[] }>;
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
async function filesBelow(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }); const result: string[] = [];
  for (const entry of entries) { const file = path.join(directory, entry.name); if (entry.isDirectory()) result.push(...await filesBelow(root, file)); else if (entry.isFile()) result.push(path.relative(root, file).split(path.sep).join("/")); }
  return result;
}
/** Hashes every regular Run file in lexicographic relative-path order, excluding itself. */
export async function createArtifactManifest(runDir: string): Promise<ArtifactManifest> {
  const manifestPath = path.relative(runDir, runArtifactPath(runDir, "artifactManifest")).split(path.sep).join("/");
  const paths = (await filesBelow(runDir)).filter((relative) => relative !== manifestPath).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const files = await Promise.all(paths.map(async (relative) => { const data = await readFile(path.join(runDir, relative)); return Object.freeze({ path: relative, sha256: digest(data), bytes: data.byteLength }); }));
  return Object.freeze({ schemaVersion: 1, algorithm: "sha256", files: Object.freeze(files) });
}
export async function writeArtifactManifest(runDir: string): Promise<ArtifactManifest> { const manifest = await createArtifactManifest(runDir); await atomicWriteJson(runArtifactPath(runDir, "artifactManifest"), manifest); return manifest; }
export const ARTIFACT_MANIFEST_PATH = RUN_ARTIFACT_PATHS.artifactManifest;
