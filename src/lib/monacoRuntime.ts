import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker.js?worker";
import TypeScriptWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

export function createMonacoWorker(_workerId: string, language: string): Worker {
  switch (language) {
    case "json": return new JsonWorker();
    case "css":
    case "scss":
    case "less": return new CssWorker();
    case "html":
    case "handlebars":
    case "razor": return new HtmlWorker();
    case "typescript":
    case "javascript": return new TypeScriptWorker();
    default: return new EditorWorker();
  }
}

/** Configure every editor before React mounts. The default React loader uses
 * a public CDN, which is unavailable under the packaged application's CSP. */
export function configureMonacoRuntime(): void {
  self.MonacoEnvironment = { getWorker: createMonacoWorker };
  loader.config({ monaco });
}
