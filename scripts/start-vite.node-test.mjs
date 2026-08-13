import assert from "node:assert/strict";
import test from "node:test";
import { probeExistingOxideVite } from "./start-vite.mjs";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

test("reuses only an OxideStudio Vite server", async () => {
  const requests = [];
  const result = await probeExistingOxideVite({
    port: 1420,
    fetchImpl: async (url) => {
      requests.push(url);
      return url.endsWith("/@vite/client")
        ? response("import '/@vite/env'")
        : response("<title>OxideStudio</title>");
    },
  });

  assert.deepEqual(result, { kind: "oxide-vite" });
  assert.deepEqual(requests, [
    "http://127.0.0.1:1420/",
    "http://127.0.0.1:1420/@vite/client",
  ]);
});

test("does not reuse a different page that happens to own the dev port", async () => {
  const result = await probeExistingOxideVite({
    port: 1420,
    fetchImpl: async () => response("<title>Other application</title>"),
  });

  assert.deepEqual(result, {
    kind: "occupied",
    detail: "its page is not OxideStudio",
  });
});

test("does not reuse an OxideStudio page that is not served by Vite", async () => {
  let call = 0;
  const result = await probeExistingOxideVite({
    port: 1420,
    fetchImpl: async () => {
      call += 1;
      return call === 1
        ? response("<title>OxideStudio</title>")
        : response("Not found", 404);
    },
  });

  assert.deepEqual(result, {
    kind: "occupied",
    detail: "it is not a Vite development server",
  });
});

test("treats a refused connection as an available port", async () => {
  const refused = new TypeError("fetch failed");
  Object.defineProperty(refused, "cause", {
    value: { code: "ECONNREFUSED" },
  });

  const result = await probeExistingOxideVite({
    port: 1420,
    fetchImpl: async () => {
      throw refused;
    },
  });

  assert.deepEqual(result, { kind: "available" });
});

test("refuses to start over a non-HTTP service", async () => {
  const rejected = new TypeError("fetch failed");
  Object.defineProperty(rejected, "cause", {
    value: { code: "ECONNRESET" },
  });

  const result = await probeExistingOxideVite({
    port: 1420,
    fetchImpl: async () => {
      throw rejected;
    },
  });

  assert.deepEqual(result, {
    kind: "occupied",
    detail: "it did not accept an HTTP probe",
  });
});
