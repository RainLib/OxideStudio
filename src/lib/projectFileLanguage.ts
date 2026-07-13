import {
  lspLanguageId,
  queryEditorLanguageId,
  supportsLspLanguageId,
} from "@/lib/databaseDialect";
import type { DatabaseDriver } from "@/services/tauri";

export interface ProjectFileLanguage {
  editorLanguageId: string;
  lspLanguageId: string;
  usesDatabaseLsp: boolean;
  executable: boolean;
}

function extensionOf(relativePath: string) {
  const name = relativePath.split("/").pop() || relativePath;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function projectFileLanguage(
  relativePath: string,
  driver: DatabaseDriver
): ProjectFileLanguage {
  const extension = extensionOf(relativePath);
  const driverEditorLanguage = queryEditorLanguageId(driver);
  const driverLspLanguage = lspLanguageId(driver);
  const driverHasLsp = supportsLspLanguageId(driver);

  if (["sql", "psql", "pgsql", "mysql"].includes(extension)) {
    const matchesDriver = driverEditorLanguage === "sql";
    return {
      editorLanguageId: "sql",
      lspLanguageId: driverLspLanguage,
      usesDatabaseLsp: driverHasLsp && matchesDriver,
      executable: matchesDriver,
    };
  }

  if (["json", "jsonc"].includes(extension)) {
    const matchesDriver = driverEditorLanguage === "json";
    return {
      editorLanguageId: "json",
      lspLanguageId: driverLspLanguage,
      usesDatabaseLsp: driverHasLsp && matchesDriver,
      executable: matchesDriver,
    };
  }

  if (extension === "eql") {
    const matchesDriver = driverLspLanguage === "elasticsearch-eql";
    return {
      editorLanguageId: "plaintext",
      lspLanguageId: driverLspLanguage,
      usesDatabaseLsp: driverHasLsp && matchesDriver,
      executable: matchesDriver,
    };
  }

  if (extension === "redis") {
    const matchesDriver = driverLspLanguage === "redis";
    return {
      editorLanguageId: "plaintext",
      lspLanguageId: driverLspLanguage,
      usesDatabaseLsp: driverHasLsp && matchesDriver,
      executable: matchesDriver,
    };
  }

  const editorLanguageId =
    {
      md: "markdown",
      markdown: "markdown",
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      html: "html",
      css: "css",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      py: "python",
      sh: "shell",
    }[extension] || "plaintext";

  return {
    editorLanguageId,
    lspLanguageId: "plaintext",
    usesDatabaseLsp: false,
    executable: false,
  };
}

export function projectFileModelUri(
  tabId: string,
  language: ProjectFileLanguage
) {
  const extension = language.editorLanguageId.replace(/[^a-z0-9]+/gi, "-");
  return `oxide://project-file/${encodeURIComponent(tabId)}.${extension || "txt"}`;
}
