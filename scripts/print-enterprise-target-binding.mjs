#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_CONNECTION_FILE_BYTES = 8_192;
const DRIVER_ALIASES = new Map([
  ["postgres", "postgres"],
  ["postgresql", "postgres"],
  ["mysql", "mysql"],
  ["mongodb", "mongodb"],
  ["mongo", "mongodb"],
  ["elasticsearch", "elasticsearch"],
  ["elastic", "elasticsearch"],
  ["redis", "redis"],
]);
const DEFAULT_PORTS = new Map([
  ["postgres", 5432],
  ["postgresql", 5432],
  ["mysql", 3306],
  ["mongodb", 27017],
  ["redis", 6379],
  ["rediss", 6380],
  ["http", 80],
  ["https", 443],
]);

function usage() {
  return "Usage: npm run enterprise:target-binding -- --driver <driver> --connection-url-file <private-file>";
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) throw new Error(usage());
    values.set(key, value);
  }
  if (values.size !== 2 || !values.has("--driver") || !values.has("--connection-url-file")) {
    throw new Error(usage());
  }
  return { driver: values.get("--driver"), connectionUrlFile: values.get("--connection-url-file") };
}

export function targetBinding(driverInput, connectionUrl) {
  const driver = DRIVER_ALIASES.get(driverInput.trim().toLowerCase());
  if (!driver) throw new Error("Unsupported managed database driver.");
  const url = new URL(connectionUrl.trim());
  if (!url.hostname) throw new Error("Database URL must include a host.");
  const port = Number(url.port) || DEFAULT_PORTS.get(url.protocol.slice(0, -1)) || 0;
  // Deliberately exclude username, password, and query parameters. Query
  // values often contain credentials; driver/scheme/host/port/path bind the
  // connection target without carrying secret material into a digest.
  const locator = `${driver}|${url.protocol.slice(0, -1)}|${url.hostname.toLowerCase()}|${port}|${url.pathname}`;
  return createHash("sha256").update(locator).digest("hex");
}

export async function main(args = process.argv.slice(2)) {
  const { driver, connectionUrlFile } = parseArguments(args);
  const path = resolve(connectionUrlFile);
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_CONNECTION_FILE_BYTES) {
    throw new Error("Connection URL file must be a non-empty regular file smaller than 8 KiB.");
  }
  const connectionUrl = (await readFile(path, "utf8")).trim();
  if (!connectionUrl) throw new Error("Connection URL file is empty.");
  process.stdout.write(`${targetBinding(driver, connectionUrl)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
