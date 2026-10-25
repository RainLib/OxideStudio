import type {
  CompletionContext,
  CompletionItem,
  CompletionResponse,
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
import {
  getLspCompletionList,
  resolveLspCompletionItem,
} from "./completion";
import type { LspCancellationToken, LspClientBridge } from "./contracts";
import {
  getLspInlineCompletionContext,
  notifyLspDidChange,
  notifyLspDidClose,
  notifyLspDidOpen,
  updateLspConfiguration,
  validateLspInlineCompletion,
} from "./documents";
import {
  formatLspDocument,
  formatLspRange,
  getLspCodeActions,
  getLspDefinitions,
  getLspDocumentSymbols,
  getLspFoldingRanges,
  getLspHover,
  getLspInlayHints,
  getLspReferences,
  getLspSelectionRanges,
  getLspSemanticTokens,
  getLspSignatureHelp,
  prepareLspRename,
  renameLspSymbol,
  searchLspWorkspaceSymbols,
} from "./navigation";
import {
  commandSessionPayload,
  invokeCancellableLspCommand,
  invokeLspCommand,
  requestSessionPayload,
} from "./transport";
import type { InlineLspContext } from "@/services/tauri/ai.service";
import {getLspDiagnosticSnapshot,type DiagnosticSnapshotRequest} from "./diagnostics";
import {createLspRuntimeObservation} from "./runtimeObservation";
import { confirmLspAnalysisConfiguration } from "./analysisConfiguration";
import {getLspDocumentStructure,type DocumentStructureKind,type DocumentStructureRequest} from "./documentStructure";
import {getLspDocumentSemantics,type DocumentSemanticKind,type DocumentSemanticRequest} from "./documentSemantics";
import {getLspDocumentCompletions,type DocumentCompletionRequest} from "./documentCompletions";
import {getLspCompletionSnapshot,type CompletionSnapshotRequest} from "./completionSnapshot";

/** Manages one scoped sql-lsp process session through Tauri commands. */
export class LspClient {
  private initialized = false;
  private readonly runtimeObservation=createLspRuntimeObservation();
  readonly getRuntimeSnapshot=this.runtimeObservation.getSnapshot;
  readonly subscribeRuntime=this.runtimeObservation.subscribe;
  private binaryPath: string | null = null;
  private initializationPromise: Promise<void> | null = null;
  private requestSequence = 0;
  private readonly bridge: LspClientBridge;

  constructor(private readonly sessionKey = "default") {
    this.bridge = {
      isInitialized: () => this.initialized,
      requestSessionPayload: () => this.requestSessionPayload(),
      commandSessionPayload: () => this.commandSessionPayload(),
      invoke: <T>(command: string, payload?: Record<string, unknown>) =>
        this.invokeCommand<T>(command, payload),
      invokeCancellable: <T>(
        command: "lsp_get_completions" | "lsp_resolve_completion" | "lsp_request",
        request: Record<string, unknown>,
        token?: LspCancellationToken,
      ) => this.invokeCancellable<T>(command, request, token),
      request: <T>(method: string, params: unknown) =>
        this.request<T>(method, params),
    };
  }

  private requestSessionPayload(): Record<string, string> {
    return requestSessionPayload(this.sessionKey);
  }

  private commandSessionPayload(): Record<string, string> {
    return commandSessionPayload(this.sessionKey);
  }

  private nextRequestToken(kind: "completion" | "resolve" | "document-completion"): string {
    this.requestSequence += 1;
    return `${kind}-${Date.now().toString(36)}-${this.requestSequence.toString(36)}`;
  }

  private async invokeCommand<T>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    return await invokeLspCommand<T>(command, payload);
  }

  private async invokeCancellable<T>(
    command: "lsp_get_completions" | "lsp_resolve_completion" | "lsp_request",
    request: Record<string, unknown>,
    token?: LspCancellationToken,
  ): Promise<T> {
    return await invokeCancellableLspCommand({
      sessionKey: this.sessionKey,
      requestToken: this.nextRequestToken(
        command === "lsp_get_completions" ? "completion" : command === "lsp_request" ? "document-completion" : "resolve",
      ),
      command,
      request,
      token,
    });
  }

  async initialize(binaryPath: string): Promise<void> {
    if (this.initializationPromise) return this.initializationPromise;

    if (this.initialized) {
      if (await this.isRunning()) {
        console.log("[LSP] Already initialized");
        return;
      }
      console.warn(
        "[LSP] Local state was initialized, but backend process is not running",
      );
      this.markDisconnected();
    }

    this.initializationPromise = this.initializeServer(binaryPath).finally(() => {
      this.initializationPromise = null;
    });
    return this.initializationPromise;
  }

  private async initializeServer(binaryPath: string): Promise<void> {
    try {
      const result = await this.invokeCommand<string>("lsp_initialize", {
        request: {
          binary_path: binaryPath,
          ...this.requestSessionPayload(),
        },
      });
      this.initialized = true;
      this.binaryPath = binaryPath;
      this.runtimeObservation.setReady(true,true);
      console.log("[LSP] Initialized:", result);
    } catch (error) {
      console.error("[LSP] Initialization failed:", error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    try {
      const result = await this.invokeCommand<string>("lsp_shutdown", {
        ...this.commandSessionPayload(),
      });
      console.log("[LSP] Shutdown:", result);
    } catch (error) {
      console.error("[LSP] Shutdown failed:", error);
      throw error;
    } finally {
      this.markDisconnected();
      this.initializationPromise = null;
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const running = await this.invokeCommand<boolean>("lsp_is_running", {
        ...this.commandSessionPayload(),
      });
      if (!running) this.markDisconnected();
      return running;
    } catch (error) {
      console.error("[LSP] Status check failed:", error);
      this.markDisconnected();
      return false;
    }
  }

  markDisconnected(): void {
    this.initialized = false;
    this.binaryPath = null;
    this.runtimeObservation.setReady(false);
  }

  async getCompletions(
    uri: string,
    line: number,
    character: number,
    context?: CompletionContext,
    token?: LspCancellationToken,
  ): Promise<CompletionItem[]> {
    return (
      await this.getCompletionList(uri, line, character, context, token)
    ).items;
  }

  async getCompletionList(
    uri: string,
    line: number,
    character: number,
    context?: CompletionContext,
    token?: LspCancellationToken,
  ): Promise<CompletionResponse> {
    return await getLspCompletionList(
      this.bridge,
      uri,
      line,
      character,
      context,
      token,
    );
  }

  async resolveCompletionItem(
    item: CompletionItem,
    token?: LspCancellationToken,
  ): Promise<CompletionItem> {
    return await resolveLspCompletionItem(this.bridge, item, token);
  }

  async getHover(
    uri: string,
    line: number,
    character: number,
  ): Promise<HoverInfo | null> {
    return await getLspHover(this.bridge, uri, line, character);
  }

  async getDefinitions(
    uri: string,
    line: number,
    character: number,
  ): Promise<Location[]> {
    return await getLspDefinitions(this.bridge, uri, line, character);
  }

  async getReferences(
    uri: string,
    line: number,
    character: number,
  ): Promise<Location[]> {
    return await getLspReferences(this.bridge, uri, line, character);
  }

  async getInlineCompletionContext(
    uri: string,
    line: number,
    character: number,
  ): Promise<InlineLspContext> {
    return await getLspInlineCompletionContext(this.bridge, uri, line, character);
  }

  async validateInlineCompletion(
    uri: string,
    text: string,
  ): Promise<Array<{ severity?: number; message: string }>> {
    return await validateLspInlineCompletion(this.bridge, uri, text);
  }

  async formatDocument(
    uri: string,
    tabSize: number,
    insertSpaces: boolean,
    throwOnError = false,
  ): Promise<TextEdit[]> {
    return await formatLspDocument(this.bridge, uri, tabSize, insertSpaces, throwOnError);
  }

  async formatRange(
    uri: string,
    range: Range,
    tabSize: number,
    insertSpaces: boolean,
  ): Promise<TextEdit[]> {
    return await formatLspRange(this.bridge, uri, range, tabSize, insertSpaces);
  }

  async getSignatureHelp(
    uri: string,
    line: number,
    character: number,
  ): Promise<SignatureHelp | null> {
    return await getLspSignatureHelp(this.bridge, uri, line, character);
  }

  async prepareRename(
    uri: string,
    line: number,
    character: number,
  ): Promise<Range | null> {
    return await prepareLspRename(this.bridge, uri, line, character);
  }

  async rename(
    uri: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<WorkspaceEdit | null> {
    return await renameLspSymbol(this.bridge, uri, line, character, newName);
  }

  async getCodeActions(
    uri: string,
    range: Range,
    diagnostics: unknown[] = [],
    only?: string[],
  ): Promise<LspCodeAction[]> {
    return await getLspCodeActions(this.bridge, uri, range, diagnostics, only);
  }

  async getDocumentSymbols(uri: string): Promise<LspDocumentSymbol[]> {
    return await getLspDocumentSymbols(this.bridge, uri);
  }
  async getDocumentCompletions(request:DocumentCompletionRequest,token?:LspCancellationToken){
    const runtime=this.getRuntimeSnapshot();if(!runtime.ready)return null;
    const result=await getLspDocumentCompletions(this.bridge,request,token);
    return this.getRuntimeSnapshot()===runtime?result:null;
  }
  async getCompletionSnapshot(request:CompletionSnapshotRequest,token?:LspCancellationToken){
    const runtime=this.getRuntimeSnapshot();if(!runtime.ready)return null;
    const result=await getLspCompletionSnapshot(this.bridge,request,token);
    return this.getRuntimeSnapshot()===runtime?result:null;
  }
  async getDocumentStructure<K extends DocumentStructureKind>(request:DocumentStructureRequest<K>){
    const runtime=this.getRuntimeSnapshot();if(!runtime.ready)return null;
    const result=await getLspDocumentStructure(this.bridge,request);
    return this.getRuntimeSnapshot()===runtime?result:null;
  }
  async getDocumentSemantics<K extends DocumentSemanticKind>(request:DocumentSemanticRequest<K>){
    const runtime=this.getRuntimeSnapshot();if(!runtime.ready)return null;
    const result=await getLspDocumentSemantics(this.bridge,request);
    return this.getRuntimeSnapshot()===runtime?result:null;
  }

  async getFoldingRanges(uri: string): Promise<LspFoldingRange[]> {
    return await getLspFoldingRanges(this.bridge, uri);
  }

  async getSelectionRanges(
    uri: string,
    positions: Position[],
  ): Promise<LspSelectionRange[]> {
    return await getLspSelectionRanges(this.bridge, uri, positions);
  }

  async getSemanticTokens(uri: string): Promise<LspSemanticTokens | null> {
    return await getLspSemanticTokens(this.bridge, uri);
  }

  async getInlayHints(uri: string, range: Range): Promise<LspInlayHint[]> {
    return await getLspInlayHints(this.bridge, uri, range);
  }
  async getDiagnosticSnapshot(request:DiagnosticSnapshotRequest){
    return getLspDiagnosticSnapshot(this.bridge,request);
  }

  async searchWorkspaceSymbols(query: string): Promise<LspWorkspaceSymbol[]> {
    return await searchLspWorkspaceSymbols(this.bridge, query);
  }

  private async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.initialized) return null as T;
    try {
      return await this.invokeCommand<T>("lsp_request", {
        request: { ...this.requestSessionPayload(), method, params },
      });
    } catch (error) {
      console.error(`[LSP] ${method} failed:`, error);
      throw error;
    }
  }

  async confirmAnalysisConfiguration(token: string): Promise<boolean> {
    const runtime = this.getRuntimeSnapshot();
    const applied = await confirmLspAnalysisConfiguration(this.bridge, token);
    return applied && runtime.ready && this.getRuntimeSnapshot() === runtime;
  }

  async updateConfiguration(config: any): Promise<void> {
    return await updateLspConfiguration(this.bridge, config);
  }

  async didOpen(
    uri: string,
    text: string,
    version: number,
    languageId = "sql",
  ): Promise<void> {
    return await notifyLspDidOpen(this.bridge, uri, text, version, languageId);
  }

  async didChange(uri: string, text: string, version: number): Promise<void> {
    return await notifyLspDidChange(this.bridge, uri, text, version);
  }

  async didClose(uri: string): Promise<void> {
    return await notifyLspDidClose(this.bridge, uri);
  }

  async syncSchemaFromConnection(): Promise<void> {
    console.warn("[LSP] syncSchemaFromConnection is handled by LspConnectionSyncer");
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getBinaryPath(): string | null {
    return this.binaryPath;
  }

  getSessionKey(): string {
    return this.sessionKey;
  }
}
