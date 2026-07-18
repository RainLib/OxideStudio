import assert from "node:assert/strict";
import test from "node:test";
import { patchMonacoReactSource } from "./patch-monaco-react.mjs";

const lifecyclePatch = {
  name: "Editor lifecycle",
  original: "disposeEditor();editorRef.current.dispose()",
  replacement:
    "disposeEditor();editorRef.current.dispose();editorRef.current=null",
};

test("patches the Monaco lifecycle cleanup", () => {
  assert.equal(
    patchMonacoReactSource(
      `before;${lifecyclePatch.original};after`,
      [lifecyclePatch],
    ),
    `before;${lifecyclePatch.replacement};after`,
  );
});

test("is idempotent after the lifecycle cleanup is patched", () => {
  const source = `before;${lifecyclePatch.replacement};after`;
  assert.equal(
    patchMonacoReactSource(source, [lifecyclePatch]),
    source,
  );
});

test("fails loudly when an installed package no longer matches", () => {
  assert.throws(
    () => patchMonacoReactSource("updated dependency source", [lifecyclePatch]),
    /patch target was not found/,
  );
});
