import type { CodingResult, ReviewResult } from "./modelSchemas.js";
import type { CheckRunReport } from "./checks.js";

export type FinalRunStatus = "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED";
export type OpenIssue = Readonly<{ source: "coding" | "review" | "runtime"; severity: "critical" | "major" | "minor" | "info"; text: string }>;
export type FinalArtifactData = Readonly<{ runId: string; status: FinalRunStatus; codingResults?: readonly CodingResult[]; reviewResults?: readonly ReviewResult[]; testReports?: readonly CheckRunReport[]; runtimeError?: string; finalDiff?: Readonly<{ baseCommit: string; headCommit: string; patch: string }> }>;
const esc = (value: string) => value.replace(/([\\`*_{}\[\]<>])/g, "\\$1");
const list = (items: readonly string[]) => items.length ? items.map((item) => `- ${esc(item)}`).join("\n") : "- none";
export function collectOpenIssues(data: FinalArtifactData): readonly OpenIssue[] {
  const issues: OpenIssue[] = [];
  for (const result of data.codingResults ?? []) for (const concern of result.remainingConcerns) issues.push({ source: "coding", severity: "info", text: concern });
  for (const result of data.reviewResults ?? []) { for (const change of result.requiredChanges) issues.push({ source: "review", severity: change.severity, text: `${change.criterionId}: ${change.description} (${change.evidence})` }); if (result.blocker) issues.push({ source: "review", severity: "major", text: result.blocker }); }
  if (data.runtimeError) issues.push({ source: "runtime", severity: "critical", text: data.runtimeError });
  return Object.freeze(issues.sort((a, b) => `${a.source}\0${a.severity}\0${a.text}`.localeCompare(`${b.source}\0${b.severity}\0${b.text}`, "en")));
}
export function renderRunSummary(data: FinalArtifactData): string { const checks = (data.testReports ?? []).flatMap((report) => report.results.map((result) => `${report.phase}/${result.id}: ${result.status}`)); return `# Run summary\n\n- Run: ${esc(data.runId)}\n- Terminal status: ${data.status}\n- Coding results: ${(data.codingResults ?? []).length}\n- Review results: ${(data.reviewResults ?? []).length}\n\n## Tests\n\n${list(checks)}\n`; }
export function renderReviewPacket(data: FinalArtifactData): string { const reviews = data.reviewResults ?? []; return `# Final review packet\n\n- Run: ${esc(data.runId)}\n- Terminal status: ${data.status}\n\n## Review decisions\n\n${reviews.length ? reviews.map((review, index) => `### Review ${index + 1}: ${review.decision}\n\n${esc(review.summary)}\n\nRequired changes:\n${list(review.requiredChanges.map((change) => `${change.severity} ${change.criterionId}: ${change.description}`))}`).join("\n\n") : "- no structured review result available"}\n\n## Final diff boundary\n\n${data.finalDiff ? `- Base commit: \`${data.finalDiff.baseCommit}\`\n- Head commit: \`${data.finalDiff.headCommit}\`` : "- no final diff available"}\n`; }
export function renderOpenIssues(data: FinalArtifactData): string { const issues = collectOpenIssues(data); return `# Open issues\n\n${issues.length ? issues.map((issue) => `- **${issue.severity}** (${issue.source}): ${esc(issue.text)}`).join("\n") : "- none"}\n`; }
