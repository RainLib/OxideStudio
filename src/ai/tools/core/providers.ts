import type { AiToolDefinition } from "@/ai/tools/types";
import {
  supportedDatabaseDriverProfiles,
  supportsLspCapabilities,
} from "@/lib/databaseDialect";
import { listRegisteredDatabaseProviders } from "@/providers";
import type { DatabaseCapabilities } from "@/services/tauri/types";

export function providerListTool(): AiToolDefinition {
  return {
    name: "provider.list",
    description:
      "List registered database providers and supported driver profiles available to the assistant.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    permissions: ["read"],
    capabilities: ["provider", "metadata"],
    timeoutMs: 5_000,
    execute: async () => {
      const driverProfiles = supportedDatabaseDriverProfiles();
      const supportedDrivers = new Set(
        driverProfiles.map((profile) => String(profile.driver)),
      );
      return {
        providers: listRegisteredDatabaseProviders().map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          priority: provider.priority ?? 0,
          activated: provider.activated,
          driverProfiles: (provider.driverProfiles ?? [])
            .filter((profile) => supportedDrivers.has(String(profile.driver)))
            .map((profile) => profile.driver),
          objectPreviewProviders: (provider.objectPreviewProviders ?? []).map(
            (previewProvider) => previewProvider.id,
          ),
          aiToolFamilies: (provider.aiToolFamilies ?? []).map(
            (family) => family.name,
          ),
        })),
        driverProfiles: driverProfiles.map((profile) => {
          const capabilities = {
            driver: profile.driver,
            ...profile.capabilities,
          } satisfies DatabaseCapabilities;
          return {
            driver: profile.driver,
            menuLabel: profile.menuLabel,
            displayName: profile.capabilities.displayName,
            dataModel: profile.capabilities.dataModel,
            lspLanguageId: profile.capabilities.lspLanguageId,
            namespaceLabel: profile.capabilities.namespaceLabel,
            defaultPort: profile.capabilities.defaultPort,
            capabilities,
            aiToolHints: aiToolHintsForCapabilities(capabilities),
          };
        }),
      };
    },
  };
}

function aiToolHintsForCapabilities(capabilities: DatabaseCapabilities) {
  const read = [
    "connection.capabilities",
    "metadata.listObjects",
    "metadata.describeObject",
    "query.runReadOnly",
  ];
  const metadata = ["metadata.listObjects", "metadata.describeObject"];
  const write = ["query.runMutation"];
  const destructive = ["query.runDestructive"];
  const lsp: string[] = [];

  if (
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing
  ) {
    read.push("metadata.listCollections");
    metadata.push("metadata.listCollections");
  }

  if (capabilities.supportsCreateDatabase) {
    write.push("database.createNamespace");
    destructive.push("database.dropNamespace");
  }

  if (capabilities.supportsTableBrowsing) {
    write.push("table.insertRows", "table.updateRows");
    destructive.push("table.deleteRows");
  }

  if (capabilities.dataModel === "document") {
    write.push("document.insertDocuments", "document.updateDocuments");
    destructive.push("document.deleteDocuments");
  } else if (capabilities.dataModel === "keyValue") {
    read.push("key.getValue");
    write.push("key.setValue");
    destructive.push("key.deleteKeys");
  } else if (capabilities.dataModel === "search") {
    write.push("search.indexDocument", "search.updateDocument");
    destructive.push("search.deleteDocument");
  }

  if (supportsLspCapabilities(capabilities)) {
    lsp.push("lsp.getCompletions", "lsp.explainDiagnostics");
    read.push(...lsp);
  }

  if (capabilities.supportsExplainPlan) {
    read.push("query.explain");
  }

  return {
    read: uniqueToolNames(read),
    metadata: uniqueToolNames(metadata),
    write: uniqueToolNames(write),
    destructive: uniqueToolNames(destructive),
    lsp: uniqueToolNames(lsp),
  };
}

function uniqueToolNames(names: string[]) {
  return Array.from(new Set(names));
}
