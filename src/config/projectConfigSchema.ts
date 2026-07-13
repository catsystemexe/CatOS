import { z } from "zod";

export const sandboxModeSchema = z.enum(["read-only", "workspace-write", "danger-full-access"]);

export const projectConfigSchema = z.object({
  project: z.object({
    id: z.string().min(1, "project.id is required"),
    name: z.string().min(1, "project.name is required"),
    repoPath: z.string().min(1, "project.repoPath is required"),
    baseBranch: z.string().min(1).optional(),
  }),
  commands: z.object({
    typecheck: z.string().min(1, "commands.typecheck is required"),
    test: z.string().min(1, "commands.test is required"),
    build: z.string().min(1, "commands.build is required"),
  }),
  workflow: z.object({
    maxReworkAttempts: z.number().int().nonnegative(),
    createCommit: z.boolean(),
  }),
  permissions: z.object({
    allowNetwork: z.boolean(),
    allowPush: z.boolean(),
    allowMerge: z.boolean(),
  }),
  execution: z.object({
    workspaceRoot: z.string().min(1).optional(),
  }).default({}),
  codex: z.object({
    sandboxMode: sandboxModeSchema.default("workspace-write"),
    acknowledgeNoSandbox: z.boolean().optional().default(false),
  }).default({ sandboxMode: "workspace-write", acknowledgeNoSandbox: false }),
  git: z.object({
    commitName: z.string().min(1).optional(),
    commitEmail: z.string().email().optional(),
    remoteName: z.string().min(1).default("origin"),
    prTargetBranch: z.string().min(1).optional(),
  }).default({ remoteName: "origin" }),
  validation: z.object({
    timeoutMs: z.number().int().positive().default(120_000),
  }).default({ timeoutMs: 120_000 }),
}).superRefine((config, ctx) => {
  if (config.codex.sandboxMode === "danger-full-access" && !config.codex.acknowledgeNoSandbox) {
    ctx.addIssue({
      code: "custom",
      path: ["codex", "acknowledgeNoSandbox"],
      message: "codex.acknowledgeNoSandbox: true is required when codex.sandboxMode is danger-full-access",
    });
  }
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
