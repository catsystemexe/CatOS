/**
 * Legacy-only dynamic modules are intentionally not production dependencies.
 * Their declarations keep archival command sources type-checkable without
 * making the v2 entrypoint install or resolve either SDK.
 */
declare module "@openai/agents" {
  export const Agent: any;
  export const run: any;
  export const setDefaultOpenAIKey: any;
}

declare module "@openai/codex-sdk" {
  export const Codex: any;
}
