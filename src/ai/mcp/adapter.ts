import {
  AiToolRegistry,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import type { AiToolExecutionContext } from "@/ai/tools";
import type { McpTool, McpToolCallResult } from "./types";

export type McpToolAdapterOptions = {
  registry?: AiToolRegistry;
  createContext?: () => AiToolExecutionContext;
};

export class McpToolAdapter {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;

  constructor(options: McpToolAdapterOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
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
      const result = await this.registry.execute(name, input, this.createContext());
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
