import type {
  HoverInfo,
  Location,
  LspCodeAction,
  LspDocumentSymbol,
  LspFoldingRange,
  LspInlayHint,
  LspSelectionRange,
  LspSemanticTokens,
  LspWorkspaceSymbol,
  Position,
  Range,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
} from "../types";
import type { LspClientBridge } from "./contracts";
import {
  isObject,
  normalizeMarkup,
  parseLocations,
  parseRange,
  parseTextEdits,
} from "./parsing";

export async function getLspHover(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
): Promise<HoverInfo | null> {
  if (!client.isInitialized()) return null;

  try {
    const response = await client.invoke<unknown>("lsp_hover", {
      request: { ...client.requestSessionPayload(), uri, line, character },
    });
    if (!isObject(response)) return null;
    const contents = normalizeMarkup(response.contents);
    return contents
      ? { contents, range: parseRange(response.range) }
      : null;
  } catch (error) {
    console.error("[LSP] ✗ Hover failed:", error);
    return null;
  }
}

async function getLspLocations(
  client: LspClientBridge,
  command: "lsp_goto_definition" | "lsp_references",
  label: "Definition" | "References",
  uri: string,
  line: number,
  character: number,
): Promise<Location[]> {
  if (!client.isInitialized()) return [];
  try {
    return parseLocations(
      await client.invoke<unknown>(command, {
        request: { ...client.requestSessionPayload(), uri, line, character },
      }),
    );
  } catch (error) {
    console.error(`[LSP] ✗ ${label} failed:`, error);
    return [];
  }
}

export async function getLspDefinitions(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
): Promise<Location[]> {
  return await getLspLocations(
    client,
    "lsp_goto_definition",
    "Definition",
    uri,
    line,
    character,
  );
}

export async function getLspReferences(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
): Promise<Location[]> {
  return await getLspLocations(
    client,
    "lsp_references",
    "References",
    uri,
    line,
    character,
  );
}

export async function formatLspDocument(
  client: LspClientBridge,
  uri: string,
  tabSize: number,
  insertSpaces: boolean,
  throwOnError = false,
): Promise<TextEdit[]> {
  if (!client.isInitialized()) {
    if (throwOnError) throw new Error("SQL intelligence is not ready for formatting.");
    return [];
  }
  try {
    return parseTextEdits(
      await client.invoke<unknown>("lsp_formatting", {
        request: {
          ...client.requestSessionPayload(),
          uri,
          tab_size: tabSize,
          insert_spaces: insertSpaces,
        },
      }),
    );
  } catch (error) {
    console.error("[LSP] ✗ Formatting failed:", error);
    if (throwOnError) throw error;
    return [];
  }
}

export async function formatLspRange(
  client: LspClientBridge,
  uri: string,
  range: Range,
  tabSize: number,
  insertSpaces: boolean,
): Promise<TextEdit[]> {
  return parseTextEdits(
    await client.request<TextEdit[]>("textDocument/rangeFormatting", {
      textDocument: { uri },
      range,
      options: { tabSize, insertSpaces },
    }),
  );
}

export async function getLspSignatureHelp(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
): Promise<SignatureHelp | null> {
  return await client.request<SignatureHelp | null>("textDocument/signatureHelp", {
    textDocument: { uri },
    position: { line, character },
  });
}

export async function prepareLspRename(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
): Promise<Range | null> {
  const response = await client.request<unknown>("textDocument/prepareRename", {
    textDocument: { uri },
    position: { line, character },
  });
  return isObject(response) && "range" in response
    ? parseRange(response.range) || null
    : parseRange(response) || null;
}

export async function renameLspSymbol(
  client: LspClientBridge,
  uri: string,
  line: number,
  character: number,
  newName: string,
): Promise<WorkspaceEdit | null> {
  return await client.request<WorkspaceEdit | null>("textDocument/rename", {
    textDocument: { uri },
    position: { line, character },
    newName,
  });
}

export async function getLspCodeActions(
  client: LspClientBridge,
  uri: string,
  range: Range,
  diagnostics: unknown[] = [],
  only?: string[],
): Promise<LspCodeAction[]> {
  return (
    (await client.request<LspCodeAction[] | null>("textDocument/codeAction", {
      textDocument: { uri },
      range,
      context: { diagnostics, ...(only?.length ? { only } : {}) },
    })) || []
  );
}

export async function getLspDocumentSymbols(
  client: LspClientBridge,
  uri: string,
): Promise<LspDocumentSymbol[]> {
  return (
    (await client.request<LspDocumentSymbol[] | null>(
      "textDocument/documentSymbol",
      { textDocument: { uri } },
    )) || []
  );
}

export async function getLspFoldingRanges(
  client: LspClientBridge,
  uri: string,
): Promise<LspFoldingRange[]> {
  return (
    (await client.request<LspFoldingRange[] | null>(
      "textDocument/foldingRange",
      { textDocument: { uri } },
    )) || []
  );
}

export async function getLspSelectionRanges(
  client: LspClientBridge,
  uri: string,
  positions: Position[],
): Promise<LspSelectionRange[]> {
  return (
    (await client.request<LspSelectionRange[] | null>(
      "textDocument/selectionRange",
      { textDocument: { uri }, positions },
    )) || []
  );
}

export async function getLspSemanticTokens(
  client: LspClientBridge,
  uri: string,
): Promise<LspSemanticTokens | null> {
  return await client.request<LspSemanticTokens | null>(
    "textDocument/semanticTokens/full",
    { textDocument: { uri } },
  );
}

export async function getLspInlayHints(
  client: LspClientBridge,
  uri: string,
  range: Range,
): Promise<LspInlayHint[]> {
  return (
    (await client.request<LspInlayHint[] | null>("textDocument/inlayHint", {
      textDocument: { uri },
      range,
    })) || []
  );
}

export async function searchLspWorkspaceSymbols(
  client: LspClientBridge,
  query: string,
): Promise<LspWorkspaceSymbol[]> {
  return (
    (await client.request<LspWorkspaceSymbol[] | null>("workspace/symbol", {
      query,
    })) || []
  );
}
