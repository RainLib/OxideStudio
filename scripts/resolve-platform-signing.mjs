import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PLATFORM_SIGNING_GROUPS = [
  {
    label: "macOS Developer ID signing",
    output: "apple_signing_enabled",
    names: [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_ID",
      "APPLE_PASSWORD",
      "APPLE_TEAM_ID",
      "KEYCHAIN_PASSWORD",
    ],
  },
  {
    label: "Windows Authenticode signing",
    output: "windows_signing_enabled",
    names: [
      "WINDOWS_CERTIFICATE",
      "WINDOWS_CERTIFICATE_PASSWORD",
      "WINDOWS_CERTIFICATE_THUMBPRINT",
    ],
  },
];

export function resolvePlatformSigning(environment) {
  return PLATFORM_SIGNING_GROUPS.map((group) => {
    const missing = group.names.filter(
      (name) => !environment[name]?.trim()
    );
    if (missing.length > 0 && missing.length < group.names.length) {
      throw new Error(
        `${group.label} is partially configured; missing: ${missing.join(", ")}`
      );
    }
    return { ...group, enabled: missing.length === 0 };
  });
}

async function main() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error("Missing GITHUB_OUTPUT.");

  const groups = resolvePlatformSigning(process.env);
  await appendFile(
    outputPath,
    `${groups.map((group) => `${group.output}=${group.enabled}`).join("\n")}\n`,
    "utf8"
  );
  for (const group of groups) {
    if (!group.enabled) {
      console.warn(
        `::warning title=${group.label} skipped::No platform signing secrets configured; the unsigned test bundle will still be built.`
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
