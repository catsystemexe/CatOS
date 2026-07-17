import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { TASK_FILE } from "./artifactPaths.js";
import { realpathWithinPackage } from "./taskPackagePaths.js";

const sha1 = z.string().regex(/^[a-f0-9]{40}$/i, "must be an immutable 40-character SHA");
const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const argv = z.array(z.string().min(1).refine((arg) => !arg.includes("\0"), "argv must not contain NUL")).min(1)
  .refine((items) => items[0] !== "--", "argv must start with an executable");
export const taskCheckSchema = z.object({ id, argv, required: z.boolean().default(true), cwd: z.string().optional() }).strict();
export const taskStepSchema = z.object({ id, title: z.string().trim().min(1), dependsOn: z.array(id).default([]), checks: z.array(id).default([]), files: z.array(z.string().min(1)).default([]) }).strict();
export const taskPackageSchema = z.object({
  schemaVersion: z.literal(2), taskId: id, task: z.string().min(1), baseCommitSha: sha1,
  checks: z.array(taskCheckSchema).default([]), steps: z.array(taskStepSchema).min(1),
}).strict().superRefine((pkg, ctx) => {
  const checkIds = new Set<string>();
  for (const check of pkg.checks) { if (checkIds.has(check.id)) ctx.addIssue({ code: "custom", path: ["checks"], message: `Duplicate check id: ${check.id}` }); checkIds.add(check.id); }
  const stepIds = new Set<string>();
  for (const step of pkg.steps) {
    if (stepIds.has(step.id)) ctx.addIssue({ code: "custom", path: ["steps"], message: `Duplicate step id: ${step.id}` }); stepIds.add(step.id);
    for (const check of step.checks) if (!checkIds.has(check)) ctx.addIssue({ code: "custom", path: ["steps", step.id, "checks"], message: `Unknown check: ${check}` });
    for (const dep of step.dependsOn) if (dep === step.id) ctx.addIssue({ code: "custom", path: ["steps", step.id, "dependsOn"], message: "A step cannot depend on itself" });
  }
  for (const step of pkg.steps) for (const dep of step.dependsOn) if (!stepIds.has(dep)) ctx.addIssue({ code: "custom", path: ["steps", step.id, "dependsOn"], message: `Unknown step: ${dep}` });
});
export type TaskPackage = z.infer<typeof taskPackageSchema>;
export const taskContentSha256 = (task: string): string => createHash("sha256").update(task, "utf8").digest("hex");
export function parseTaskPackage(value: unknown): TaskPackage { return taskPackageSchema.parse(value); }
/** Reads only a complete schema-valid task file; malformed/partial data is rejected. */
export async function readTaskPackage(packageDir: string): Promise<TaskPackage> {
  const file = await realpathWithinPackage(packageDir, TASK_FILE);
  return parseTaskPackage(JSON.parse(await readFile(file, "utf8")));
}
