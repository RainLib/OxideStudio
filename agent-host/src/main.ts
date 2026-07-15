#!/usr/bin/env node
import { AgentRuntime } from "./runtime.js";
import { JsonRpcPeer } from "./rpc.js";

const stderr = (...values: unknown[]) => {
  const message = values
    .map((value) => (value instanceof Error ? value.message : String(value)))
    .join(" ")
    .replace(/(?:sk-|AKIA|LTAI)[A-Za-z0-9_-]{8,}/gu, "[redacted]")
    .slice(0, 2_000);
  process.stderr.write(`[agent-host] ${message}\n`);
};

console.log = stderr;
console.info = stderr;
console.warn = stderr;
console.error = stderr;

const peer = new JsonRpcPeer(process.stdin, process.stdout);
const runtime = new AgentRuntime(peer);

let shuttingDown = false;
const shutdown = (exitCode: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime.cancelAll();
  peer.close();
  // A piped stdin keeps Node's event loop alive after SIGTERM. Closing the
  // streams and exiting explicitly makes application shutdown deterministic.
  process.stdin.destroy();
  process.stdout.end();
  process.exit(exitCode);
};
process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.once("uncaughtException", (error) => {
  stderr(error);
  shutdown(1);
});
process.once("unhandledRejection", (error) => {
  stderr(error);
  shutdown(1);
});

peer.run().then(
  () => shutdown(0),
  (error) => {
    stderr(error);
    shutdown(1);
  },
);
