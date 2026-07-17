/** Environment boundary for a Codex CLI child.  Values are deliberately never retained. */
export const DENIED_RUNTIME_VARIABLES = ["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_BASE_URL"] as const;
const CUSTOM_PROVIDER = /(?:^|_)(?:ANTHROPIC|AZURE|GOOGLE|GEMINI|VERTEX|AWS|BEDROCK|MISTRAL|COHERE|TOGETHER|OPENROUTER|OLLAMA|PROVIDER)(?:_|$)/i;

export type RuntimeEnvironment = { env: NodeJS.ProcessEnv; metadata: { policy: "explicit-child-environment"; allowedNames: string[]; deniedNames: string[] } };

/**
 * Builds a new environment rather than mutating/inheriting process.env.  This is
 * operational credential containment, not a security sandbox.
 */
export function createCodexChildEnvironment(source: NodeJS.ProcessEnv = process.env, extra: NodeJS.ProcessEnv = {}): RuntimeEnvironment {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "LANG", "LC_ALL", "TERM", "HOME", "TMPDIR", "TMP", "TEMP", "NO_COLOR"] as const) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  for (const [name, value] of Object.entries(extra)) if (value !== undefined && !isDeniedRuntimeVariable(name)) env[name] = value;
  const deniedNames = Object.keys(source).filter(isDeniedRuntimeVariable).sort();
  return { env, metadata: { policy: "explicit-child-environment", allowedNames: Object.keys(env).sort(), deniedNames } };
}

export function isDeniedRuntimeVariable(name: string): boolean {
  return (DENIED_RUNTIME_VARIABLES as readonly string[]).includes(name) || CUSTOM_PROVIDER.test(name) && /(KEY|TOKEN|SECRET|URL|ENDPOINT|CREDENTIAL)/i.test(name);
}
