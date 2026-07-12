import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { finalResultSchema, type FinalResult } from "./schemas/finalResult.js";
import { humanDecisionSchema, type EvidenceReviewed, type HumanDecision } from "./schemas/humanDecision.js";

export type HumanGateInput = {
  runId: string;
  runDir: string;
  finalResult: FinalResult;
};

export type HumanDecisionInput = {
  decision: "APPROVE" | "REJECT" | "REQUEST_CHANGES";
  comment?: string;
  requestedChanges?: string[];
  evidenceReviewed: EvidenceReviewed;
};

export interface HumanGate {
  recordDecision(input: HumanGateInput, decision: HumanDecisionInput): Promise<HumanDecision>;
}

async function ensureFile(filePath: string, label: string): Promise<void> {
  try {
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is not a file")) throw error;
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

export function resolveRunArtifact(runDir: string, artifactPath: string | undefined, fallback: string): string {
  const chosen = artifactPath && artifactPath.trim().length > 0 ? artifactPath : fallback;
  return path.isAbsolute(chosen) ? chosen : path.join(runDir, chosen);
}

export async function loadFinalResult(runDir: string): Promise<FinalResult> {
  const finalResultPath = path.join(runDir, "final-result.json");
  const raw = JSON.parse(await readFile(finalResultPath, "utf8")) as unknown;
  return finalResultSchema.parse(raw);
}

export class FileHumanGate implements HumanGate {
  async recordDecision(input: HumanGateInput, decisionInput: HumanDecisionInput): Promise<HumanDecision> {
    if (input.finalResult.runId !== input.runId) {
      throw new Error(`final-result.json runId (${input.finalResult.runId}) does not match requested run (${input.runId}).`);
    }

    const decisionPath = path.join(input.runDir, "human-decision.json");
    try {
      await stat(decisionPath);
      throw new Error(`Human decision already exists: ${decisionPath}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Human decision already exists")) throw error;
    }

    await ensureFile(path.join(input.runDir, "task-brief.json"), "task brief");
    await ensureFile(resolveRunArtifact(input.runDir, input.finalResult.finalDiffPath, "workspace.diff"), "final diff");
    await ensureFile(resolveRunArtifact(input.runDir, input.finalResult.finalValidationReportPath, "validation report"), "final validation report");
    await ensureFile(resolveRunArtifact(input.runDir, input.finalResult.finalReviewReportPath, "review-report.json"), "final review report");

    const decision = humanDecisionSchema.parse({
      schemaVersion: 1,
      runId: input.runId,
      decision: decisionInput.decision,
      decidedAt: new Date().toISOString(),
      finalResultStatus: input.finalResult.status,
      comment: decisionInput.comment,
      requestedChanges: decisionInput.requestedChanges ?? [],
      evidenceReviewed: decisionInput.evidenceReviewed,
    });

    await mkdir(input.runDir, { recursive: true });
    await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return decision;
  }
}

export function formatZodError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ");
  return error instanceof Error ? error.message : String(error);
}
