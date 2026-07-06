import type { AiToolRegistry } from "@/ai/tools/registry";
import {
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
} from "@/ai/tools/policy";
import { createAiToolManifest } from "@/ai/tools/manifest";
import type {
  AiToolCapability,
  AiToolExecutionContext,
  AiToolExecutionPolicy,
  AiToolPermission,
  AiToolSummary,
} from "@/ai/tools/types";
import type {
  McpTool,
  McpToolAnnotations,
  McpToolCallResult,
  McpToolManifestResult,
} from "./types";

export type McpToolAdapterOptions = {
  registry?: AiToolRegistry;
  createContext?: () => AiToolExecutionContext;
  policy?: AiToolExecutionPolicy;
};

export type McpToolCallOptions = {
  approved?: boolean;
  contextOverrides?: McpContextOverrides;
};

type McpContextOverrides = Pick<
  AiToolExecutionContext,
  "activeConnectionId" | "activeDriver" | "activeNamespace"
>;

export class McpToolAdapter {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;
  private readonly policy: AiToolExecutionPolicy;

  constructor(options: McpToolAdapterOptions = {}) {
    if (!options.registry || !options.createContext) {
      throw new Error(
        "McpToolAdapter requires registry and createContext options"
      );
    }
    this.registry = options.registry;
    this.createContext = options.createContext;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
  }

  listTools(): McpTool[] {
    return this.registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations: toMcpAnnotations(tool),
    }));
  }

  manifest(): McpToolManifestResult {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            createAiToolManifest(this.registry.list(), this.policy),
            null,
            2
          ),
        },
      ],
    };
  }

  async callTool(
    name: string,
    input: unknown,
    options: McpToolCallOptions = {}
  ): Promise<McpToolCallResult> {
    try {
      const policy = options.approved
        ? approveAiToolForPolicy(this.policy, name)
        : this.policy;
      const result = await this.registry.executeWithPolicy(
        name,
        input,
        applyContextOverrides(this.createContext(), options.contextOverrides),
        policy
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

function applyContextOverrides(
  context: AiToolExecutionContext,
  overrides: McpContextOverrides | undefined
): AiToolExecutionContext {
  if (!overrides) return context;

  return {
    ...context,
    ...(overrides.activeConnectionId !== undefined
      ? { activeConnectionId: overrides.activeConnectionId }
      : {}),
    ...(overrides.activeDriver !== undefined
      ? { activeDriver: overrides.activeDriver }
      : {}),
    ...(overrides.activeNamespace !== undefined
      ? { activeNamespace: overrides.activeNamespace }
      : {}),
  };
}

export function createMcpToolAdapter(options?: McpToolAdapterOptions) {
  return new McpToolAdapter(options);
}

function toMcpAnnotations(tool: AiToolSummary): McpToolAnnotations {
  const readOnly = isReadOnly(tool.permissions);
  return {
    title: tool.name,
    readOnlyHint: readOnly,
    destructiveHint: tool.permissions.includes("destructive"),
    idempotentHint: readOnly,
    openWorldHint: touchesExternalState(tool.capabilities),
  };
}

function isReadOnly(permissions: AiToolPermission[]) {
  return permissions.length > 0 && permissions.every((permission) => permission === "read");
}

function touchesExternalState(capabilities: AiToolCapability[]) {
  return capabilities.some((capability) =>
    ["connection", "metadata", "query"].includes(capability)
  );
}
