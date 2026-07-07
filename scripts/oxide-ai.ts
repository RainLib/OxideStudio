#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createCliToolAdapter } from "@/ai/cli/adapter";
import { createMcpProtocolAdapter } from "@/ai/mcp/protocol";
import type { McpProtocolAdapter } from "@/ai/mcp/protocol";
import {
  describeCoreAiToolEnvironment,
  registerCoreAiTools,
} from "@/ai/tools/coreTools";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import { createAiToolRegistry } from "@/ai/tools/registry";
import type {
  AiToolAdapters,
  AiToolExecutionContext,
} from "@/ai/tools/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

function createHeadlessAdapters(): AiToolAdapters {
  return {
    listConnections: () => [],
    getConnectionCapabilities: (driver) => defaultDatabaseCapabilities(driver),
  };
}

function createHeadlessContext(): AiToolExecutionContext {
  return {
    requestId: createRequestId(),
    activeConnectionId: null,
    activeDriver: null,
    activeNamespace: null,
    activeTab: null,
  };
}

function createRequestId() {
  return `oxide-ai-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function main() {
  const adapters = createHeadlessAdapters();
  const registry = registerCoreAiTools(
    createAiToolRegistry(),
    adapters
  );
  const manifestEnvironment = {
    ...describeCoreAiToolEnvironment(adapters, "headless-cli"),
    notes: [
      "The bundled headless CLI exposes provider and capability discovery by default.",
      "Database metadata, query, mutation, workspace, and LSP tools require an injected adapter or the in-app Tauri runtime.",
    ],
  };
  const createContext = createHeadlessContext;
  const args = process.argv.slice(2);

  if (isMcpStdioCommand(args)) {
    await runMcpStdio(
      createMcpProtocolAdapter({
        registry,
        createContext,
        policy: DEFAULT_AI_TOOL_POLICY,
        manifestEnvironment,
      })
    );
    return;
  }

  const cli = createCliToolAdapter({
    registry,
    createContext,
    policy: DEFAULT_AI_TOOL_POLICY,
    manifestEnvironment,
    readFile: (path) => readFile(path, "utf8"),
  });
  const result = await cli.run(args);

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

function isMcpStdioCommand(args: string[]) {
  return args[0] === "mcp" && args[1] === "stdio";
}

async function runMcpStdio(protocol: McpProtocolAdapter) {
  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  const pending = new Set<Promise<void>>();

  for await (const line of lines) {
    if (!line.trim()) continue;
    const task = protocol
      .handleJson(line)
      .then((response) => {
        if (response) {
          process.stdout.write(`${response}\n`);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[oxide-ai] MCP stdio error: ${message}\n`);
      });
    pending.add(task);
    task.finally(() => pending.delete(task));
  }

  await Promise.allSettled(pending);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
