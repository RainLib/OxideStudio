import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
async function windowsMemory(pid) {
  const { stdout } = await execute("powershell", ["-NoProfile", "-NonInteractive", "-Command",
    `$fixtureProcess=Get-Process -Id ${pid}; @{peakWorkingSetBytes=$fixtureProcess.PeakWorkingSet64;privateMemoryAtMeasurementBytes=$fixtureProcess.PrivateMemorySize64}|ConvertTo-Json -Compress`,
  ], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  return JSON.parse(stdout.trim());
}

/** Retry a timed-out observer on the same owned PID; never restart the job. */
export async function nativeProcessMemory(pid, {
  platform = process.platform,
  isAlive = () => true,
  observeWindows = windowsMemory,
  readStatus = file => fs.readFile(file, "utf8"),
  onRetry = () => {},
} = {}) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "invalid native process id");
  if (!["win32", "linux"].includes(platform)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.ok(isAlive(), "owned native process ended before memory observation");
    try {
      const value = platform === "win32" ? await observeWindows(pid) : {
        peakWorkingSetBytes: Number((await readStatus(`/proc/${pid}/status`)).match(/^VmHWM:\s+(\d+) kB/m)?.[1]) * 1024,
      };
      assert.ok(isAlive(), "owned native process ended during memory observation");
      assert.ok(Number.isSafeInteger(value?.peakWorkingSetBytes) && value.peakWorkingSetBytes > 0, "missing native peak working set");
      return value;
    } catch (error) {
      const timeout = error.code === "ETIMEDOUT" ||
        ((error.code === null || error.code === undefined) && error.killed === true && error.signal === "SIGTERM");
      if (platform !== "win32" || !timeout || attempt !== 0 || !isAlive()) throw error;
      onRetry({ pid, attempt: attempt + 1, reason: "observer_timeout" });
    }
  }
  throw new Error("native memory observation did not complete");
}
