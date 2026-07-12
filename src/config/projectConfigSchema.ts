import { z } from "zod";

export const projectConfigSchema = z.object({
  project: z.object({
    id: z.string().min(1, "project.id is required"),
    name: z.string().min(1, "project.name is required"),
    repoPath: z.string().min(1, "project.repoPath is required"),
    baseBranch: z.string().min(1, "project.baseBranch is required"),
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
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
