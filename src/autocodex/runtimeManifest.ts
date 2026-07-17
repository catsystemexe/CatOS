import { isDeniedRuntimeVariable } from "./runtimePolicy.js";

export type RuntimeManifestInput = Readonly<{
  catosVersion?: string; catosCommit?: string; codexCliVersion?: string; requestedModel?: string; reportedModel?: string;
  codingSandbox?: string; reviewSandbox?: string; authenticationType?: "api-key" | "oauth" | "environment" | "none" | "unknown"; configurationSha256?: string; promptTemplateSha256?: string;
  os?: string; runtime?: string; gitVersion?: string; startedAt?: string; finishedAt?: string;
  limits?: Readonly<{ tasks?: number; steps?: number; attempts?: number }>;
  environment?: Readonly<{ allowedNames?: readonly string[]; deniedNames?: readonly string[] }>;
}>;
export type RuntimeManifest = Readonly<{ schemaVersion: 1; catos: { version?: string; commit?: string }; codex: { cliVersion?: string; requestedModel?: string; reportedModel?: string; codingSandbox?: string; reviewSandbox?: string }; authentication: { type?: string }; hashes: { configurationSha256?: string; promptTemplateSha256?: string }; platform: { os?: string; runtime?: string; gitVersion?: string }; startedAt?: string; finishedAt?: string; limits: { tasks?: number; steps?: number; attempts?: number }; environment: { allowedNames: string[]; deniedNames: string[] } }>;

/** Creates a whitelist-only runtime record. Credential values are never accepted. */
export function createRuntimeManifest(input: RuntimeManifestInput): RuntimeManifest {
  const allowed = [...new Set((input.environment?.allowedNames ?? []).filter((name) => !isDeniedRuntimeVariable(name)))].sort();
  const denied = [...new Set([...(input.environment?.deniedNames ?? []).filter(isDeniedRuntimeVariable)])].sort();
  return Object.freeze({ schemaVersion: 1, catos: { version: input.catosVersion, commit: input.catosCommit }, codex: { cliVersion: input.codexCliVersion, requestedModel: input.requestedModel, reportedModel: input.reportedModel, codingSandbox: input.codingSandbox, reviewSandbox: input.reviewSandbox }, authentication: { type: input.authenticationType }, hashes: { configurationSha256: input.configurationSha256, promptTemplateSha256: input.promptTemplateSha256 }, platform: { os: input.os, runtime: input.runtime, gitVersion: input.gitVersion }, startedAt: input.startedAt, finishedAt: input.finishedAt, limits: { ...input.limits }, environment: { allowedNames: allowed, deniedNames: denied } });
}
