import type {
  AiToolDefinition,
  AiToolExecutionContext,
  AiToolSummary,
} from "./types";

export class AiToolRegistry {
  private readonly tools = new Map<string, AiToolDefinition>();

  register<TInput, TOutput>(tool: AiToolDefinition<TInput, TOutput>) {
    const name = tool.name.trim();
    if (!name) {
      throw new Error("AI tool name is required");
    }
    if (this.tools.has(name)) {
      throw new Error(`AI tool already registered: ${name}`);
    }

    this.tools.set(name, tool as AiToolDefinition);
    return this;
  }

  get(name: string) {
    return this.tools.get(name.trim()) || null;
  }

  list(): AiToolSummary[] {
    return Array.from(this.tools.values()).map(({ execute: _execute, ...tool }) => ({
      ...tool,
    }));
  }

  async execute<TOutput = unknown>(
    name: string,
    input: unknown,
    context: AiToolExecutionContext
  ): Promise<TOutput> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`AI tool not found: ${name}`);
    }

    if (!tool.timeoutMs || tool.timeoutMs <= 0) {
      return (await tool.execute(input, context)) as TOutput;
    }

    return withTimeout(
      Promise.resolve(tool.execute(input, context)) as Promise<TOutput>,
      tool.timeoutMs,
      tool.name
    );
  }
}

export function createAiToolRegistry() {
  return new AiToolRegistry();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string
) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`AI tool timed out after ${timeoutMs}ms: ${toolName}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
