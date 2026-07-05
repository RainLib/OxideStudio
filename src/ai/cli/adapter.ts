import {
  AiToolRegistry,
  DEFAULT_AI_TOOL_POLICY,
  approveAiToolForPolicy,
  createWorkspaceAiToolContext,
  createWorkspaceAiToolRegistry,
} from "@/ai/tools";
import type { AiToolExecutionContext, AiToolExecutionPolicy } from "@/ai/tools";
import type { CliInputReader, CliToolCommandResult } from "./types";

export type CliToolAdapterOptions = {
  registry?: AiToolRegistry;
  createContext?: () => AiToolExecutionContext;
  readFile?: CliInputReader;
  policy?: AiToolExecutionPolicy;
};

type ParsedCommand =
  | { kind: "help" }
  | { kind: "list" }
  | { kind: "call"; toolName: string; input: unknown; approved: boolean };

export class CliToolAdapter {
  private readonly registry: AiToolRegistry;
  private readonly createContext: () => AiToolExecutionContext;
  private readonly readFile?: CliInputReader;
  private readonly policy: AiToolExecutionPolicy;

  constructor(options: CliToolAdapterOptions = {}) {
    this.registry = options.registry ?? createWorkspaceAiToolRegistry();
    this.createContext = options.createContext ?? createWorkspaceAiToolContext;
    this.readFile = options.readFile;
    this.policy = options.policy ?? DEFAULT_AI_TOOL_POLICY;
  }

  async run(argv: string[]): Promise<CliToolCommandResult> {
    try {
      const command = await this.parse(argv);
      switch (command.kind) {
        case "help":
          return ok(helpText());
        case "list":
          return okJson(this.registry.list());
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

    if (command === "call" || (command === "tools" && rest[0] === "call")) {
      const callArgs = command === "tools" ? rest.slice(1) : rest;
      return this.parseCall(callArgs);
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
    "  tools call <toolName> [--json '{...}']",
    "  tools call <toolName> [--json-file payload.json]",
    "  tools call <toolName> --approve [--json '{...}']",
    "",
  ].join("\n");
}
