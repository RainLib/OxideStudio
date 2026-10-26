// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  editor: vi.fn(function () { return { kind: "editor" }; }),
  json: vi.fn(function () { return { kind: "json" }; }),
  css: vi.fn(function () { return { kind: "css" }; }),
  html: vi.fn(function () { return { kind: "html" }; }),
  typescript: vi.fn(function () { return { kind: "typescript" }; }),
}));
vi.mock("@monaco-editor/react", () => ({ loader: { config: mocks.config } }));
vi.mock("monaco-editor", () => ({ editor: { create: vi.fn() } }));
vi.mock("monaco-editor/esm/vs/editor/editor.worker.js?worker", () => ({ default: mocks.editor }));
vi.mock("monaco-editor/esm/vs/language/json/json.worker.js?worker", () => ({ default: mocks.json }));
vi.mock("monaco-editor/esm/vs/language/css/css.worker.js?worker", () => ({ default: mocks.css }));
vi.mock("monaco-editor/esm/vs/language/html/html.worker.js?worker", () => ({ default: mocks.html }));
vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker.js?worker", () => ({ default: mocks.typescript }));

import * as monaco from "monaco-editor";
import { configureMonacoRuntime, createMonacoWorker } from "./monacoRuntime";

const previous = self.MonacoEnvironment;
afterEach(() => { self.MonacoEnvironment = previous; vi.clearAllMocks(); });

it("initializes the React loader with the bundled editor and local worker factory", () => {
  configureMonacoRuntime();
  expect(mocks.config).toHaveBeenCalledExactlyOnceWith({ monaco });
  expect(self.MonacoEnvironment?.getWorker).toBe(createMonacoWorker);
});

it.each([
  ["json", "json"], ["css", "css"], ["scss", "css"], ["less", "css"],
  ["html", "html"], ["handlebars", "html"], ["razor", "html"],
  ["typescript", "typescript"], ["javascript", "typescript"],
  ["sql", "editor"], ["plaintext", "editor"],
])("selects the packaged worker for %s", (language, kind) => {
  expect(createMonacoWorker("worker-id", language)).toEqual({ kind });
});
