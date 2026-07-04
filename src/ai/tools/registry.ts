import type {
  AiToolAuditEntry,
  AiToolDefinition,
  AiToolExecutionPolicy,
  AiToolExecutionContext,
  AiToolSummary,
} from "./types";
import { evaluateAiToolPolicy } from "./policy";

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

  evaluate(name: string, policy?: AiToolExecutionPolicy) {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`AI tool not found: ${name}`);
    }
    return evaluateAiToolPolicy(tool, policy);
  }

  async executeWithPolicy<TOutput = unknown>(
    name: string,
    input: unknown,
    context: AiToolExecutionContext,
    policy?: AiToolExecutionPolicy
  ): Promise<TOutput> {
    const startedAt = Date.now();
    const decision = this.evaluate(name, policy);
    if (!decision.allowed) {
      await recordAudit(context, {
        requestId: context.requestId,
        toolName: name,
        permissions: decision.permissions,
        status: "blocked",
        startedAt,
        durationMs: Date.now() - startedAt,
        reason: decision.reason,
      });
      throw new Error(
        decision.reason || `AI tool is not allowed by policy: ${name}`
      );
    }

    try {
      const result = await this.execute<TOutput>(name, input, context);
      await recordAudit(context, {
        requestId: context.requestId,
        toolName: name,
        permissions: decision.permissions,
        status: "success",
        startedAt,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (err: any) {
      await recordAudit(context, {
        requestId: context.requestId,
        toolName: name,
        permissions: decision.permissions,
        status: "error",
        startedAt,
        durationMs: Date.now() - startedAt,
        reason: err?.message || String(err),
      });
      throw err;
    }
  }
}

export function createAiToolRegistry() {
  return new AiToolRegistry();
}

async function recordAudit(
  context: AiToolExecutionContext,
  entry: AiToolAuditEntry
) {
  try {
    await context.audit?.(entry);
  } catch (err) {
    console.warn("[AI tools] Audit sink failed:", err);
  }
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
