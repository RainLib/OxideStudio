import { elasticsearchRequestNavigationOffset } from "@/features/query-languages/elasticsearch/requests";
import type { ElasticsearchAnalysisResponse } from "@/workers/elasticsearchAnalysis.worker";
import { useEffect } from "react";

interface ElasticsearchAnalysisContext {
  monaco: typeof import("monaco-editor") | null;
  mountedEditor: any;
  isElasticsearchConsole: boolean;
  elasticsearchAnalysisRequestIdRef: React.RefObject<number>;
  elasticsearchRequestLinesRef: React.RefObject<Set<number>>;
  elasticsearchDecorationIdsRef: React.RefObject<string[]>;
  elasticsearchAnalysisApplyRef: React.RefObject<
    | ((
        response: import("@/workers/elasticsearchAnalysis.worker").ElasticsearchAnalysisResponse,
      ) => void)
    | null
  >;
  elasticsearchAnalysisWorkerRef: React.RefObject<Worker | null>;
  runCurrentActionRef: React.RefObject<() => void>;
  elasticsearchAnalysisTimerRef: React.RefObject<number | null>;
  documentUri: string;
  activeDocumentSql: string;
  runAllActionRef: React.RefObject<() => void>;
  formatActionRef: React.RefObject<() => void>;
}

export function useElasticsearchAnalysis({
  monaco,
  mountedEditor,
  isElasticsearchConsole,
  elasticsearchAnalysisRequestIdRef,
  elasticsearchRequestLinesRef,
  elasticsearchDecorationIdsRef,
  elasticsearchAnalysisApplyRef,
  elasticsearchAnalysisWorkerRef,
  runCurrentActionRef,
  elasticsearchAnalysisTimerRef,
  documentUri,
  activeDocumentSql,
  runAllActionRef,
  formatActionRef,
}: ElasticsearchAnalysisContext) {
  useEffect(() => {
    if (!monaco || !mountedEditor) return;
    const model = mountedEditor.getModel();
    if (!model) return;

    if (!isElasticsearchConsole) {
      monaco.editor.setModelMarkers(model, "elasticsearch-console", []);
      return;
    }

    const applyAnalysis = (response: ElasticsearchAnalysisResponse) => {
      if (
        response.requestId !== elasticsearchAnalysisRequestIdRef.current ||
        mountedEditor.getModel() !== model
      ) {
        return;
      }

      monaco.editor.setModelMarkers(
        model,
        "elasticsearch-console",
        response.diagnostics.map((diagnostic) => {
          const start = model.getPositionAt(diagnostic.startOffset);
          const end = model.getPositionAt(
            Math.max(diagnostic.startOffset + 1, diagnostic.endOffset),
          );
          return {
            severity:
              diagnostic.severity === "error"
                ? monaco.MarkerSeverity.Error
                : monaco.MarkerSeverity.Warning,
            message: diagnostic.message,
            source: "Elasticsearch Console",
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
        }),
      );

      const requestLines = new Set(
        response.requestStartOffsets.map(
          (offset) => model.getPositionAt(offset).lineNumber,
        ),
      );
      elasticsearchRequestLinesRef.current = requestLines;
      elasticsearchDecorationIdsRef.current = mountedEditor.deltaDecorations(
        elasticsearchDecorationIdsRef.current,
        Array.from(requestLines).map((lineNumber) => ({
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            glyphMarginClassName: "oxide-es-run-glyph",
            glyphMarginHoverMessage: {
              value: "Run this Elasticsearch request (⌘/Ctrl+Enter)",
            },
          },
        })),
      );
    };
    elasticsearchAnalysisApplyRef.current = applyAnalysis;

    let worker: Worker | null = null;
    try {
      worker = new Worker(
        new URL(
          "../../../workers/elasticsearchAnalysis.worker.ts",
          import.meta.url,
        ),
        { type: "module", name: "oxide-elasticsearch-analysis" },
      );
      worker.onmessage = (event: MessageEvent<ElasticsearchAnalysisResponse>) =>
        applyAnalysis(event.data);
      elasticsearchAnalysisWorkerRef.current = worker;
    } catch (error) {
      console.warn("Elasticsearch analysis worker is unavailable", error);
    }

    const mouseDisposable = mountedEditor.onMouseDown((event: any) => {
      if (
        event.target?.type !==
          monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        !elasticsearchRequestLinesRef.current.has(
          event.target.position?.lineNumber,
        )
      ) {
        return;
      }
      const position = {
        lineNumber: event.target.position.lineNumber,
        column: 1,
      };
      mountedEditor.setPosition(position);
      mountedEditor.setSelection({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: 1,
      });
      mountedEditor.focus();
      runCurrentActionRef.current();
    });

    return () => {
      elasticsearchAnalysisRequestIdRef.current += 1;
      if (elasticsearchAnalysisTimerRef.current !== null) {
        window.clearTimeout(elasticsearchAnalysisTimerRef.current);
        elasticsearchAnalysisTimerRef.current = null;
      }
      worker?.terminate();
      if (elasticsearchAnalysisWorkerRef.current === worker) {
        elasticsearchAnalysisWorkerRef.current = null;
      }
      elasticsearchAnalysisApplyRef.current = null;
      mouseDisposable.dispose();
      mountedEditor.deltaDecorations(elasticsearchDecorationIdsRef.current, []);
      elasticsearchDecorationIdsRef.current = [];
      elasticsearchRequestLinesRef.current = new Set();
      monaco.editor.setModelMarkers(model, "elasticsearch-console", []);
    };
  }, [documentUri, isElasticsearchConsole, monaco, mountedEditor]);

  useEffect(() => {
    if (!mountedEditor || !isElasticsearchConsole) return;
    const model = mountedEditor.getModel();
    if (!model) return;

    if (elasticsearchAnalysisTimerRef.current !== null) {
      window.clearTimeout(elasticsearchAnalysisTimerRef.current);
    }
    const requestId = elasticsearchAnalysisRequestIdRef.current + 1;
    elasticsearchAnalysisRequestIdRef.current = requestId;
    const source = model.getValue();
    elasticsearchAnalysisTimerRef.current = window.setTimeout(() => {
      elasticsearchAnalysisTimerRef.current = null;
      const worker = elasticsearchAnalysisWorkerRef.current;
      if (worker) {
        worker.postMessage({ requestId, source });
        return;
      }

      // Worker creation can be blocked by an unusually strict host policy.
      // Keep Console usable in that environment, but defer the fallback so it
      // never runs in the input event itself.
      void import("@/lib/elasticsearchConsole").then(
        ({ parseElasticsearchConsoleRequests, validateElasticsearchConsole }) =>
          elasticsearchAnalysisApplyRef.current?.({
            requestId,
            diagnostics: validateElasticsearchConsole(source),
            requestStartOffsets: parseElasticsearchConsoleRequests(source).map(
              (request) => request.startOffset,
            ),
          }),
      );
    }, 140);

    return () => {
      if (elasticsearchAnalysisTimerRef.current !== null) {
        window.clearTimeout(elasticsearchAnalysisTimerRef.current);
        elasticsearchAnalysisTimerRef.current = null;
      }
    };
  }, [activeDocumentSql, isElasticsearchConsole, mountedEditor]);

  useEffect(() => {
    if (!monaco || !mountedEditor || !isElasticsearchConsole) return;

    const navigate = (direction: "previous" | "next") => {
      const model = mountedEditor.getModel();
      const position = mountedEditor.getPosition();
      if (!model || !position) return;
      const offset = elasticsearchRequestNavigationOffset(
        model.getValue(),
        model.getOffsetAt(position),
        direction,
      );
      if (offset === null) return;
      const target = model.getPositionAt(offset);
      mountedEditor.setPosition(target);
      mountedEditor.revealPositionInCenterIfOutsideViewport(target);
      mountedEditor.focus();
    };

    const actions = [
      mountedEditor.addAction({
        id: "oxide.elasticsearch.runCurrent",
        label: "Run current Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => runCurrentActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.runAll",
        label: "Run all Elasticsearch requests",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter,
        ],
        run: () => runAllActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.formatCurrent",
        label: "Auto-indent current Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI],
        run: () => formatActionRef.current(),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.nextRequest",
        label: "Go to next Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.DownArrow],
        run: () => navigate("next"),
      }),
      mountedEditor.addAction({
        id: "oxide.elasticsearch.previousRequest",
        label: "Go to previous Elasticsearch request",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.UpArrow],
        run: () => navigate("previous"),
      }),
    ];

    return () => actions.forEach((action) => action.dispose());
  }, [isElasticsearchConsole, monaco, mountedEditor]);
}
