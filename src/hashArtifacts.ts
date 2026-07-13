import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export type ApprovedEvidence = {
  diffSha256: string;
  validationReportSha256: string;
  reviewReportSha256: string;
};

export function sha256Text(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256Text(await readFile(filePath, "utf8"));
}
