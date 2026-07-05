import {
  AiToolRegistry,
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
  createAiToolManifest,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import { createMcpProtocolAdapter } from "@/ai/mcp";
import type { AiToolExecutionContext, AiToolExecutionPolicy } from "@/ai/tools";
import { createAssistantRuntime } from "@/ai/assistant";
import type { AssistantPlanner, AssistantTurnInput } from "@/ai/assistant";
import type { CliInputReader, CliToolCommandResult } from "./types";

export type CliToolAdapterOptions = {
  registry?: AiToolRegistry;
  createContext?: () => AiToolExecutionContext;
  readFile?: CliInputReader;
  policy?: AiToolExecutionPolicy;
  planner?: AssistantPlanner;
};

type ParsedCommand =
  | { kind: "help" }
  | { kind: "list" }
  | { kind: "manifest" }
  | { kind: "mcp"; request: string }
  | { kind: "plan"; input: AssistantTurnInput }
  | { kind: "call"; toolName: string; input: unknown; approved: boolean };

export class CliToolAdapter {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;
  private readonly readFile?: CliInputReader;
  private readonly policy: AiToolExecutionPolicy;
  private readonly planner?: AssistantPlanner;

  constructor(options: CliToolAdapterOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
    this.readFile = options.readFile;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
    this.planner = options.planner;
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
          return okJson(createAiToolManifest(this.registry.list(), this.policy));
        case "mcp": {
          const response = await createMcpProtocolAdapter({
            registry: this.registry,
            createContext: this.createContext,
            policy: this.policy,
          }).handleJson(command.request);
          return ok(response ? `${response}\n` : "");
        }
        case "plan":
          return okJson(
            await createAssistantRuntime({
              registry: this.registry,
              createContext: this.createContext,
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
            this.createContext(),
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
      return { kind: "plan", input: await this.parsePlan(planArgs) };
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
      throw new Error(`Unknown call argument: ${arg}`);
    }

    return { kind: "call", toolName, input, approved };
  }

  private async parsePlan(args: string[]): Promise<AssistantTurnInput> {
    let input: AssistantTurnInput = { message: "" };
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
      throw new Error(`Unknown plan argument: ${arg}`);
    }

    if (!input.message.trim()) {
      throw new Error("assistant plan requires --message or --json");
    }
    return input;
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

function helpText() {
  return [
    "Oxide AI tools",
    "",
    "Commands:",
    "  tools list",
    "  tools manifest",
    "  assistant plan --message 'show active schema'",
    "  assistant plan --json '{\"message\":\"explain this query\"}'",
    "  tools call <toolName> [--json '{...}']",
    "  tools call <toolName> [--json-file payload.json]",
    "  tools call <toolName> --approve [--json '{...}']",
    "  mcp request --json '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}'",
    "",
  ].join("\n");
}
