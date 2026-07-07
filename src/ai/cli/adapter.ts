import type { AiToolRegistry } from "@/ai/tools/registry";
import {
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
} from "@/ai/tools/policy";
import { createAiToolManifest } from "@/ai/tools/manifest";
import type { AiToolManifestEnvironment } from "@/ai/tools/manifest";
import type {
  AiToolExecutionContext,
  AiToolExecutionPolicy,
} from "@/ai/tools/types";
import { createMcpProtocolAdapter } from "@/ai/mcp/protocol";
import { createAssistantRuntime } from "@/ai/assistant/runtime";
import type {
  AssistantPlanner,
  AssistantTurnInput,
} from "@/ai/assistant/types";
import type { CliInputReader, CliToolCommandResult } from "./types";

export type CliToolAdapterOptions = {
  registry?: AiToolRegistry;
  createContext?: () => AiToolExecutionContext;
  readFile?: CliInputReader;
  policy?: AiToolExecutionPolicy;
  planner?: AssistantPlanner;
  manifestEnvironment?: AiToolManifestEnvironment;
};

type ParsedCommand =
  | { kind: "help" }
  | { kind: "list" }
  | { kind: "manifest" }
  | { kind: "inspect"; toolName: string }
  | { kind: "mcp"; request: string }
  | {
      kind: "plan";
      input: AssistantTurnInput;
      contextOverrides: CliContextOverrides;
    }
  | {
      kind: "call";
      toolName: string;
      input: unknown;
      approved: boolean;
      contextOverrides: CliContextOverrides;
    };

type CliContextOverrides = Pick<
  AiToolExecutionContext,
  "activeConnectionId" | "activeDriver" | "activeNamespace"
>;

export class CliToolAdapter {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;
  private readonly readFile?: CliInputReader;
  private readonly policy: AiToolExecutionPolicy;
  private readonly planner?: AssistantPlanner;
  private readonly manifestEnvironment?: AiToolManifestEnvironment;

  constructor(options: CliToolAdapterOptions = {}) {
    if (!options.registry || !options.createContext) {
      throw new Error(
        "CliToolAdapter requires registry and createContext options"
      );
    }
    this.registry = options.registry;
    this.createContext = options.createContext;
    this.readFile = options.readFile;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
    this.planner = options.planner;
    this.manifestEnvironment = options.manifestEnvironment;
  }

  async run(argv: string[]): Promise<CliToolCommandResult> {
    try {
      const command = await this.parse(argv);
      switch (command.kind) {
        case "help":
          return ok(helpText());
        case "list":
          return okJson(this.registry.list());
        case "manifest":
          return okJson(
            createAiToolManifest(
              this.registry.list(),
              this.policy,
              this.manifestEnvironment
            )
          );
        case "inspect":
          return okJson(this.inspectTool(command.toolName));
        case "mcp": {
          const response = await createMcpProtocolAdapter({
            registry: this.registry,
            createContext: this.createContext,
            policy: this.policy,
            manifestEnvironment: this.manifestEnvironment,
          }).handleJson(command.request);
          return ok(response ? `${response}\n` : "");
        }
        case "plan":
          return okJson(
            await createAssistantRuntime({
              registry: this.registry,
              createContext: () =>
                applyContextOverrides(
                  this.createContext(),
                  command.contextOverrides
                ),
              policy: this.policy,
              planner: this.planner,
            }).prepareTurnAsync(command.input)
          );
        case "call": {
          const policy = command.approved
            ? approveAiToolForPolicy(this.policy, command.toolName)
            : this.policy;
          const result = await this.registry.executeWithPolicy(
            command.toolName,
            command.input,
            applyContextOverrides(this.createContext(), command.contextOverrides),
            policy
          );
          return okJson(result);
        }
      }
    } catch (err: any) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `${err?.message || String(err)}\n`,
      };
    }
  }

  private async parse(argv: string[]): Promise<ParsedCommand> {
    const args = normalizeArgv(argv);
    const [command, ...rest] = args;

    if (!command || command === "help" || command === "--help" || command === "-h") {
      return { kind: "help" };
    }

    if (command === "list" || (command === "tools" && rest[0] === "list")) {
      return { kind: "list" };
    }

    if (
      command === "manifest" ||
      (command === "tools" && rest[0] === "manifest")
    ) {
      return { kind: "manifest" };
    }

    if (command === "inspect" || (command === "tools" && rest[0] === "inspect")) {
      const inspectArgs = command === "tools" ? rest.slice(1) : rest;
      const [toolName, ...extra] = inspectArgs;
      if (!toolName) {
        throw new Error("Tool name is required");
      }
      if (extra.length > 0) {
        throw new Error(`Unknown inspect argument: ${extra[0]}`);
      }
      return { kind: "inspect", toolName };
    }

    if (command === "call" || (command === "tools" && rest[0] === "call")) {
      const callArgs = command === "tools" ? rest.slice(1) : rest;
      return this.parseCall(callArgs);
    }

    if (command === "mcp" && (!rest[0] || rest[0] === "request")) {
      const requestArgs = rest[0] === "request" ? rest.slice(1) : rest;
      return { kind: "mcp", request: await this.parseMcpRequest(requestArgs) };
    }

    if (
      command === "plan" ||
      (command === "assistant" && rest[0] === "plan") ||
      (command === "tools" && rest[0] === "plan")
    ) {
      const planArgs = command === "assistant" || command === "tools"
        ? rest.slice(1)
        : rest;
      const { input, contextOverrides } = await this.parsePlan(planArgs);
      return { kind: "plan", input, contextOverrides };
    }

    throw new Error(`Unknown AI tools command: ${command}`);
  }

  private async parseCall(args: string[]): Promise<ParsedCommand> {
    const [toolName, ...rest] = args;
    if (!toolName) {
      throw new Error("Tool name is required");
    }

    let input: unknown = {};
    let approved = false;
    const contextOverrides: CliContextOverrides = {};
    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index];
      if (arg === "--approve") {
        approved = true;
        continue;
      }
      if (arg === "--json") {
        const value = rest[index + 1];
        if (value === undefined) {
          throw new Error("--json requires a JSON payload");
        }
        input = parseJson(value);
        index += 1;
        continue;
      }
      if (arg === "--json-file") {
        const path = rest[index + 1];
        if (!path) {
          throw new Error("--json-file requires a file path");
        }
        if (!this.readFile) {
          throw new Error("--json-file requires a file reader adapter");
        }
        input = parseJson(await this.readFile(path));
        index += 1;
        continue;
      }
      if (arg === "--active-connection-id") {
        const value = rest[index + 1];
        if (value === undefined) {
          throw new Error("--active-connection-id requires a value");
        }
        contextOverrides.activeConnectionId = value || null;
        index += 1;
        continue;
      }
      if (arg === "--active-driver") {
        const value = rest[index + 1];
        if (value === undefined) {
          throw new Error("--active-driver requires a value");
        }
        contextOverrides.activeDriver =
          value as AiToolExecutionContext["activeDriver"];
        index += 1;
        continue;
      }
      if (arg === "--active-namespace") {
        const value = rest[index + 1];
        if (value === undefined) {
          throw new Error("--active-namespace requires a value");
        }
        contextOverrides.activeNamespace = value || null;
        index += 1;
        continue;
      }
      throw new Error(`Unknown call argument: ${arg}`);
    }

    return { kind: "call", toolName, input, approved, contextOverrides };
  }

  private async parsePlan(args: string[]): Promise<{
    input: AssistantTurnInput;
    contextOverrides: CliContextOverrides;
  }> {
    let input: AssistantTurnInput = { message: "" };
    const contextOverrides: CliContextOverrides = {};
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--message" || arg === "-m") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error(`${arg} requires a message`);
        }
        input = { ...input, message: value };
        index += 1;
        continue;
      }
      if (arg === "--selected-text") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error("--selected-text requires a value");
        }
        input = { ...input, selectedText: value };
        index += 1;
        continue;
      }
      if (arg === "--json") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error("--json requires a JSON payload");
        }
        input = parsePlanJson(value);
        index += 1;
        continue;
      }
      if (arg === "--json-file") {
        const path = args[index + 1];
        if (!path) {
          throw new Error("--json-file requires a file path");
        }
        if (!this.readFile) {
          throw new Error("--json-file requires a file reader adapter");
        }
        input = parsePlanJson(await this.readFile(path));
        index += 1;
        continue;
      }
      if (arg === "--active-connection-id") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error("--active-connection-id requires a value");
        }
        contextOverrides.activeConnectionId = value || null;
        index += 1;
        continue;
      }
      if (arg === "--active-driver") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error("--active-driver requires a value");
        }
        contextOverrides.activeDriver =
          value as AiToolExecutionContext["activeDriver"];
        index += 1;
        continue;
      }
      if (arg === "--active-namespace") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error("--active-namespace requires a value");
        }
        contextOverrides.activeNamespace = value || null;
        index += 1;
        continue;
      }
      throw new Error(`Unknown plan argument: ${arg}`);
    }

    if (!input.message.trim()) {
      throw new Error("assistant plan requires --message or --json");
    }
    return { input, contextOverrides };
  }

  private async parseMcpRequest(args: string[]) {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "--json") {
        const value = args[index + 1];
        if (value === undefined) {
          throw new Error("--json requires a JSON-RPC request");
        }
        return value;
      }
      if (arg === "--json-file") {
        const path = args[index + 1];
        if (!path) {
          throw new Error("--json-file requires a file path");
        }
        if (!this.readFile) {
          throw new Error("--json-file requires a file reader adapter");
        }
        return this.readFile(path);
      }
      throw new Error(`Unknown mcp request argument: ${arg}`);
    }

    throw new Error("mcp request requires --json or --json-file");
  }

  private inspectTool(toolName: string) {
    const manifest = createAiToolManifest(
      this.registry.list(),
      this.policy,
      this.manifestEnvironment
    );
    const tool = manifest.tools.find((candidate) => candidate.name === toolName);
    if (!tool) {
      throw new Error(`Unknown AI tool: ${toolName}`);
    }
    return tool;
  }
}

export function createCliToolAdapter(options?: CliToolAdapterOptions) {
  return new CliToolAdapter(options);
}

function normalizeArgv(argv: string[]) {
  const offset =
    argv.length >= 2 && argv[0]?.includes("node") && argv[1]?.includes("oxide")
      ? 2
      : 0;
  return argv.slice(offset);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch (err: any) {
    throw new Error(`Invalid JSON payload: ${err?.message || String(err)}`);
  }
}

function parsePlanJson(value: string): AssistantTurnInput {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Plan JSON payload must be an object");
  }

  const payload = parsed as Record<string, unknown>;
  if (typeof payload.message !== "string") {
    throw new Error("Plan JSON payload requires a string message");
  }
  return {
    message: payload.message,
    selectedText:
      typeof payload.selectedText === "string" ? payload.selectedText : null,
  };
}

function ok(stdout: string): CliToolCommandResult {
  return { exitCode: 0, stdout };
}

function okJson(value: unknown): CliToolCommandResult {
  return ok(`${JSON.stringify(value, null, 2)}\n`);
}

function applyContextOverrides(
  context: AiToolExecutionContext,
  overrides: CliContextOverrides
): AiToolExecutionContext {
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

function helpText() {
  return [
    "Oxide AI tools",
    "",
    "Commands:",
    "  tools list",
    "  tools manifest",
    "  tools inspect <toolName>",
    "  assistant plan --message 'show active schema'",
    "  assistant plan --json '{\"message\":\"explain this query\"}'",
    "  assistant plan --message 'read key session:1' --active-driver redis",
    "  tools call <toolName> [--json '{...}']",
    "  tools call <toolName> [--json-file payload.json]",
    "  tools call <toolName> --active-driver redis --active-namespace 2 [--json '{...}']",
    "  tools call <toolName> --approve [--json '{...}']",
    "  mcp request --json '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'",
    "  mcp stdio",
    "",
  ].join("\n");
}
