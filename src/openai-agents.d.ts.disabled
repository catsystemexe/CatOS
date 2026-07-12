declare module "@openai/agents" {
  export class Agent<TContext = unknown> {
    constructor(options: Record<string, unknown>);
  }

  export function run<TAgent extends Agent>(agent: TAgent, input: string, options?: Record<string, unknown>): Promise<{ finalOutput: unknown }>;
  export function setDefaultOpenAIKey(apiKey: string): void;
}
