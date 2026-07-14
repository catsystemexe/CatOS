import { z } from "zod";

export const finalResultErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  stepId: z.string().optional(),
  details: z.string().optional(),
});

export const changedFileSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["created", "modified", "deleted"]),
  exists: z.boolean(),
});

export const outputFileSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  type: z.literal("file").optional(),
  contentAvailable: z.boolean().optional(),
  kind: z.string().optional(),
  readable: z.boolean().optional(),
});

export const runArtifactSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  kind: z.string().min(1),
  readable: z.boolean(),
});

export const finalResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  status: z.enum(["ACCEPTED", "HUMAN_REQUIRED", "REWORK_LIMIT_REACHED", "completed", "failed", "stopped"]),
  terminalMessage: z.string().optional(),
  error: finalResultErrorSchema.nullish(),
  workspacePath: z.string().optional(),
  changedFiles: z.array(changedFileSchema).optional(),
  outputs: z.array(outputFileSchema).optional(),
  runArtifacts: z.array(runArtifactSchema).optional(),
  finalResponse: z.string().optional(),
  finalReviewVerdict: z.enum(["ACCEPT", "REWORK", "HUMAN_REQUIRED"]),
  totalCodingAttempts: z.number().int().positive(),
  reworkAttempts: z.number().int().nonnegative(),
  finalWorkspacePath: z.string().min(1),
  finalChangedFiles: z.array(z.string()),
  finalValidationStatus: z.enum(["PASS", "FAIL", "BLOCKED"]),
  finalReviewReportPath: z.string().min(1),
  finalDiffPath: z.string().min(1).optional(),
  finalValidationReportPath: z.string().min(1).optional(),
});

export type FinalResult = z.infer<typeof finalResultSchema>;
