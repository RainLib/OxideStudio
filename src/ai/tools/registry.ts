import type {
  AiToolAuditEntry,
  AiToolDefinition,
  AiToolExecutionPolicy,
  AiToolExecutionContext,
  AiToolSummary,
  JsonSchema,
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

    const inputError = validateToolInput(input, tool.inputSchema);
    if (inputError) {
      throw new Error(`Invalid input for AI tool ${tool.name}: ${inputError}`);
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

function validateToolInput(input: unknown, schema: JsonSchema) {
  return validateJsonSchema(input, schema, "$");
}

function validateJsonSchema(
  value: unknown,
  schema: JsonSchema | undefined,
  path: string
): string | null {
  if (!schema) return null;

  const expectedType = inferredSchemaType(schema);
  if (expectedType && !matchesJsonSchemaType(value, expectedType)) {
    return `${path} must be ${expectedType}`;
  }

  if (schema.enum && !schema.enum.includes(String(value))) {
    return `${path} must be one of: ${schema.enum.join(", ")}`;
  }

  if (expectedType === "object") {
    const objectValue = value as Record<string, unknown>;
    const requiredProperties = new Set(schema.required || []);
    for (const key of requiredProperties) {
      if (!(key in objectValue)) {
        return `${path}.${key} is required`;
      }
    }

    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (key in objectValue) {
        if (objectValue[key] === null && !requiredProperties.has(key)) {
          continue;
        }
        const error = validateJsonSchema(
          objectValue[key],
          propertySchema,
          `${path}.${key}`
        );
        if (error) return error;
      }
    }

    const knownProperties = new Set(Object.keys(schema.properties || {}));
    const additionalProperties = schema.additionalProperties;
    for (const key of Object.keys(objectValue)) {
      if (knownProperties.has(key)) continue;
      if (additionalProperties === false) {
        return `${path}.${key} is not allowed`;
      }
      if (
        additionalProperties &&
        typeof additionalProperties === "object"
      ) {
        const error = validateJsonSchema(
          objectValue[key],
          additionalProperties,
          `${path}.${key}`
        );
        if (error) return error;
      }
    }
  }

  if (expectedType === "array" && Array.isArray(value) && schema.items) {
    for (let index = 0; index < value.length; index += 1) {
      const error = validateJsonSchema(
        value[index],
        schema.items,
        `${path}[${index}]`
      );
      if (error) return error;
    }
  }

  return null;
}

function inferredSchemaType(schema: JsonSchema) {
  if (schema.type) return schema.type;
  if (
    schema.properties ||
    schema.required ||
    schema.additionalProperties !== undefined
  ) {
    return "object";
  }
  if (schema.items) return "array";
  return null;
}

function matchesJsonSchemaType(value: unknown, type: string) {
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "string":
      return typeof value === "string";
    default:
      return true;
  }
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
