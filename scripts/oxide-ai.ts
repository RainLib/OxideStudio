#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createCliToolAdapter } from "@/ai/cli/adapter";
import { registerCoreAiTools } from "@/ai/tools/coreTools";
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
  const registry = registerCoreAiTools(
    createAiToolRegistry(),
    createHeadlessAdapters()
  );
  const createContext = createHeadlessContext;
  const cli = createCliToolAdapter({
    registry,
    createContext,
    policy: DEFAULT_AI_TOOL_POLICY,
    readFile: (path) => readFile(path, "utf8"),
  });
  const result = await cli.run(process.argv.slice(2));

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
