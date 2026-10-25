import { test } from "node:test";
import assert from "node:assert/strict";
import { nativeProcessMemory } from "./lib/native-process-memory.mjs";
const timeout = () => Object.assign(new Error("observer timeout"), { killed: true, signal: "SIGTERM" });

test("retries only the observer for the same live pid, retaining mandatory peak data", async () => {
  const observed = [], retries = [];
  const value = await nativeProcessMemory(123, { platform: "win32", observeWindows: async pid => {
    observed.push(pid); if (observed.length === 1) throw timeout();
    return { peakWorkingSetBytes: 4096, privateMemoryAtMeasurementBytes: 2048 };
  }, onRetry: value => retries.push(value) });
  assert.deepEqual(observed, [123, 123]); assert.equal(retries.length, 1);
  assert.equal(value.peakWorkingSetBytes, 4096);
});
test("repeated timeout remains a failure after two observations", async () => {
  let calls = 0;
  await assert.rejects(nativeProcessMemory(123, { platform: "win32", observeWindows: async () => { calls++; throw timeout(); } }), /observer timeout/);
  assert.equal(calls, 2);
});
test("does not retry when the owned process stopped", async () => {
  let alive = true, calls = 0;
  await assert.rejects(nativeProcessMemory(123, { platform: "win32", isAlive: () => alive, observeWindows: async () => { calls++; alive = false; throw timeout(); } }), /observer timeout/);
  assert.equal(calls, 1);
});
test("does not soften malformed metrics or unrelated errors", async () => {
  await assert.rejects(nativeProcessMemory(123, { platform: "win32", observeWindows: async () => ({ peakWorkingSetBytes: 0 }) }), /missing native peak/);
  await assert.rejects(nativeProcessMemory(123, { platform: "win32", observeWindows: async () => { throw new Error("access denied"); } }), /access denied/);
  await assert.rejects(nativeProcessMemory(-1), /invalid native process/);
  let calls = 0;
  await assert.rejects(nativeProcessMemory(123, { platform: "win32", observeWindows: async () => {
    calls++;
    throw Object.assign(new Error("output exceeded buffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", killed: true, signal: "SIGTERM" });
  } }), /output exceeded buffer/);
  assert.equal(calls, 1);
});
test("reads Linux lifetime high water and rejects missing high water", async () => {
  const value = await nativeProcessMemory(123, { platform: "linux", readStatus: async file => { assert.equal(file, "/proc/123/status"); return "Name:\tnative\nVmHWM:\t32 kB\n"; } });
  assert.equal(value.peakWorkingSetBytes, 32768);
  await assert.rejects(nativeProcessMemory(123, { platform: "linux", readStatus: async () => "Name:\tnative\n" }), /missing native peak/);
});
