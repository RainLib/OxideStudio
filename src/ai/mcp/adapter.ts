import {
  AiToolRegistry,
  DEFAULT_AI_TOOL_POLICY,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import type { AiToolExecutionContext, AiToolExecutionPolicy } from "@/ai/tools";
import type { McpTool, McpToolCallResult } from "./types";

export type McpToolAdapterOptions = {
  registry?: AiToolRegistry;
  createContext?: () => AiToolExecutionContext;
  policy?: AiToolExecutionPolicy;
};

export class McpToolAdapter {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;
  private readonly policy: AiToolExecutionPolicy;

  constructor(options: McpToolAdapterOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
  }

  listTools(): McpTool[] {
    return this.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, input: unknown): Promise<McpToolCallResult> {
    try {
      const result = await this.registry.executeWithPolicy(
        name,
        input,
        this.createContext(),
        this.policy
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: err?.message || String(err),
          },
        ],
      };
    }
  }
}

export function createMcpToolAdapter(options?: McpToolAdapterOptions) {
  return new McpToolAdapter(options);
}
