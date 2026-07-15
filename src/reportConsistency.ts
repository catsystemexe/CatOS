import path from "node:path";

const GENERIC_SLASH_PHRASES = new Set(["input/output", "workspace diff/status", "diff/status", "file/path"]);
const FILE_EXTENSIONS = /\.(?:md|txt|json|diff|log|ts|tsx|js|jsx|mjs|cjs|css|html|ya?ml|toml|rs|go|py|java|kt|c|cc|cpp|h|hpp|sh|sql|png|jpe?g|gif|svg|webp)$/i;

function normalizeCandidate(candidate: string): string | undefined {
  let value = candidate.trim().replace(/^['"`(<\[]+|['"`)>\].,:;!?]+$/g, "");
  value = value.replace(/\\/g, "/");
  if (!value || GENERIC_SLASH_PHRASES.has(value.toLowerCase())) return undefined;
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:\//.test(value)) return undefined;
  const normalized = path.posix.normalize(value).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) return undefined;
  if (!normalized.includes("/")) return undefined;
  if (!FILE_EXTENSIONS.test(normalized)) return undefined;
  return normalized;
}

export function extractExpectedFiles(task: unknown): string[] {
  const text = String(task ?? "");
  const candidates: string[] = [];
  const pushMatches = (regex: RegExp) => {
    for (const m of text.matchAll(regex)) if (m[1]) candidates.push(m[1]);
  };
  pushMatches(/`([^`]+)`/g);
  pushMatches(/\b(?:Create(?: exactly one new)?|Create file|Modify|Delete)\s+(?:file\s+|path\s+)?([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)\b/gi);
  pushMatches(/^\s*file:\s*([^\s]+)\s*$/gim);
  for (const m of text.matchAll(/(^|\s)([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.[A-Za-z0-9]+)\b/gm)) if (m[2]) candidates.push(m[2]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const normalized = normalizeCandidate(c);
    if (normalized && !seen.has(normalized)) { seen.add(normalized); out.push(normalized); }
  }
  return out;
}

export function sanitizeUserVisibleText(input: unknown): string {
  let text = String(input ?? "");
  text = text.replace(/\[([^\]]+)\]\(((?:\/|[A-Za-z]:\\)[^)]+?[\\/]workspace[\\/]([^)]+))\)/g, (_m, label, _abs, rel) => `[${label}](${String(rel).replace(/\\/g, "/")})`);
  text = text.replace(/(?<![A-Za-z0-9._-])\/(?:home|workspace|tmp|var|private|mnt|opt|root|Users|run)\/[^\s"'`)]+/g, (m) => {
    const marker = m.match(/[\\/]workspace[\\/](.+)$/);
    return marker?.[1] ? marker[1].replace(/\\/g, "/") : "<path>";
  });
  text = text.replace(/[A-Za-z]:\\[^\s"'`)]+/g, (m) => {
    const marker = m.match(/[\\/]workspace[\\/](.+)$/);
    return marker?.[1] ? marker[1].replace(/\\/g, "/") : "<path>";
  });
  return text;
}
