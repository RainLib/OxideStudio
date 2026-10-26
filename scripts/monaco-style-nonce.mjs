const stylesheetModule = "/monaco-editor/esm/vs/base/browser/domStylesheets.js";
const styleCreation = "const style = document.createElement('style');";

/** Tauri nonces the startup styles, making CSP ignore 'unsafe-inline'.
 * Monaco's ESM stylesheet factory must carry that same nonce before insertion.
 * Keep this scoped to Monaco so its dynamic stylesheets stay nonce-checked
 * without patching document.createElement globally.
 */
export function monacoStyleNoncePlugin() {
  return {
    name: "oxide-monaco-style-nonce",
    enforce: "pre",
    transform(source, id) {
      if (!id.replaceAll("\\", "/").split("?", 1)[0].endsWith(stylesheetModule)) return;
      if (source.split(styleCreation).length !== 2) {
        throw new Error("Monaco stylesheet factory changed; review its CSP nonce integration before bundling.");
      }
      return {
        code: source.replace(styleCreation, `${styleCreation}
    // Read .nonce: CSP deliberately hides nonce values from getAttribute().
    const oxideStyleNonce = document.querySelector('style[nonce]')?.nonce;
    if (oxideStyleNonce) style.nonce = oxideStyleNonce;`),
        map: null,
      };
    },
  };
}
