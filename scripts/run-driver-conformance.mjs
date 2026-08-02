#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  evidenceReference,
  runDriverConformance,
  sha256Bytes,
} from "./lib/driver-conformance.mjs";

function option(name, required = false) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`${name} requires a value`);
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function usage() {
  console.log("Usage: node scripts/run-driver-conformance.mjs --manifest <manifest.json> --fixture <fixture.json> --out <report.json> [--target <triple>] [--java <path>] [--reference-out <json> --report-url <https-url>]");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const manifestPath = resolve(option("--manifest", true));
  const fixturePath = resolve(option("--fixture", true));
  const outputPath = resolve(option("--out", true));
  const referenceOutput = option("--reference-out");
  const reportUrl = option("--report-url");
  if (Boolean(referenceOutput) !== Boolean(reportUrl)) {
    throw new Error("--reference-out and --report-url must be provided together");
  }
  const { report } = await runDriverConformance({
    manifestPath,
    fixturePath,
    target: option("--target") || undefined,
    javaBinary: option("--java"),
  });
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(outputPath, reportBytes, { flag: "wx" });
  const digest = sha256Bytes(reportBytes);
  if (referenceOutput) {
    const reference = evidenceReference(report, reportUrl, digest);
    await writeFile(resolve(referenceOutput), `${JSON.stringify(reference, null, 2)}\n`, { flag: "wx" });
  }
  // Print identities only. URLs, options, statements and result values are
  // intentionally absent from both stdout and the durable report.
  console.log(`Driver conformance passed: ${report.package.driverId} ${report.package.packageVersion} / ${report.serverVersion}`);
  console.log(`Evidence SHA-256: ${digest}`);
  // Read back once so a filesystem failure cannot be mistaken for a durable report.
  await readFile(outputPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
