import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { monacoStyleNoncePlugin } from "./monaco-style-nonce.mjs";

const modulePath = new URL("../node_modules/monaco-editor/esm/vs/base/browser/domStylesheets.js", import.meta.url);
const source = await readFile(modulePath, "utf8");
const plugin = monacoStyleNoncePlugin();

function fixture(nonce) {
  const code = plugin.transform(source, modulePath.pathname).code;
  const factory = code.slice(code.indexOf("function createStyleSheet("), code.indexOf("function cloneGlobalStyleSheet("));
  const appended = [];
  const head = { appendChild: style => appended.push(style) };
  const document = {
    head,
    createElement: () => ({}),
    querySelector: selector => {
      assert.equal(selector, "style[nonce]");
      return nonce === undefined ? null : { nonce, getAttribute: () => "" };
    },
  };
  const create = new Function("document", "mainWindow", "globalStylesheets", "getWindows", `${factory}; return createStyleSheet;`)(document, { document }, new Map(), () => []);
  return { create, appended };
}

test("sets the Tauri stylesheet nonce before Monaco writes or appends CSS", () => {
  const { create, appended } = fixture("startup-style-nonce");
  const style = create(undefined, element => {
    assert.equal(element.nonce, "startup-style-nonce");
    assert.equal(appended.length, 0);
    element.textContent = ".cursor { background: blue; }";
  });
  assert.equal(appended[0], style);
  assert.equal(style.nonce, "startup-style-nonce");
});

test("keeps normal development styles working without a CSP nonce", () => {
  const { create } = fixture();
  assert.equal(create().nonce, undefined);
});

test("does not transform other dependencies and rejects unsupported Monaco changes", () => {
  assert.equal(plugin.transform(source, "/another-library/domStylesheets.js"), undefined);
  assert.throws(() => plugin.transform("changed factory", modulePath.pathname), /factory changed/);
});

test("permits Monaco layout attributes without adding inline script permission", async () => {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const directives = new Map(config.app.security.csp.split(";").map(part => {
    const [name, ...sources] = part.trim().split(/\s+/);
    return [name, sources];
  }));
  assert.deepEqual(directives.get("style-src-attr"), ["'unsafe-inline'"]);
  assert.deepEqual(directives.get("script-src"), ["'self'"]);
  assert.equal(config.app.security.dangerousDisableAssetCspModification, undefined);
});
