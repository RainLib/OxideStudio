import {
  type AgentToolManifestEntry,
  type ResolveApprovalParams,
} from "@oxide/agent-contract";
import { isRecord } from "./value.js";

export function approvalResolution(
  value: unknown,
  approvalId: string,
): "approve" | "reject" {
  if (
    !isRecord(value) ||
    value.kind !== "approval" ||
    value.approvalId !== approvalId ||
    (value.decision !== "approve" && value.decision !== "reject")
  ) {
    throw new Error("Approval resume payload is invalid or stale.");
  }
  return value.decision;
}

export function isReviewableWorkspaceWrite(manifest: AgentToolManifestEntry) {
  return (
    manifest.name === "project.writeFile" &&
    manifest.permissions.length === 1 &&
    manifest.permissions[0] === "write"
  );
}

export function toolRequiresApproval(manifest: AgentToolManifestEntry) {
  return (
    manifest.permissions.some((permission) => permission !== "read") &&
    !isReviewableWorkspaceWrite(manifest)
  );
}

export function isToolAllowedForProfile(
  manifest: AgentToolManifestEntry,
  profile: "chat" | "plan" | "agent",
): boolean {
  if (profile === "chat") return false;
  if (profile === "plan") {
    return (
      manifest.name !== "project.writeFile" &&
      manifest.permissions.length > 0 &&
      manifest.permissions.every((p) => p === "read")
    );
  }
  return true;
}

export function approvalRisk(
  manifest: AgentToolManifestEntry,
): "write" | "destructive" | "external" {
  if (manifest.permissions.includes("destructive")) return "destructive";
  if (manifest.permissions.includes("external")) return "external";
  return "write";
}

export function processLabel(toolName: string): string {
  if (toolName === "project.listFiles") return "Listed project files";
  if (toolName === "project.readFile") return "Read project file";
  if (toolName === "project.writeFile") return "Edited project file";
  if (toolName === "shell.execute") return "Ran shell command";
  if (toolName.startsWith("metadata.")) return "Read schema";
  if (toolName.startsWith("query.")) return "Ran query analysis";
  if (toolName.startsWith("lsp.")) return "Read editor diagnostics";
  if (toolName.startsWith("editor.")) return "Prepared editor change";
  return toolName.replace(/[._-]+/gu, " ");
}

export function projectToolRelativePath(
  toolName: string,
  input: unknown,
): string | undefined {
  if (
    (toolName !== "project.readFile" && toolName !== "project.writeFile") ||
    !isRecord(input) ||
    typeof input.path !== "string"
  ) {
    return undefined;
  }
  const rawPath = input.path;
  if (
    !rawPath ||
    rawPath.length > 2_000 ||
    rawPath.includes("\0") ||
    /^[\\/]/u.test(rawPath) ||
    /^[a-z]:/iu.test(rawPath)
  ) {
    return undefined;
  }
  const segments = rawPath
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

export function approvalSummary(toolName: string, input: unknown): string {
  if (toolName === "project.writeFile" && isRecord(input)) {
    const rawPath =
      typeof input.path === "string" ? input.path : "unknown file";
    const path =
      rawPath.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 200) ||
      "unknown file";
    const action = input.create === true ? "Create" : "Replace";
    const characters =
      typeof input.content === "string" ? input.content.length : 0;
    return `${action} ${path} with ${characters.toLocaleString("en-US")} characters. File contents are omitted from this approval summary.`;
  }
  if (toolName === "shell.execute" && isRecord(input)) {
    const command =
      typeof input.command === "string"
        ? input.command
            .replace(/[\u0000-\u001f\u007f]+/gu, " ")
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 600)
        : "unknown command";
    const sandbox =
      input.sandboxMode === "unrestricted" ? "unrestricted" : "workspace-write";
    const cwd =
      typeof input.cwd === "string" && input.cwd.trim()
        ? input.cwd.trim().slice(0, 200)
        : "project root";
    return `Run once in ${sandbox} mode from ${cwd}: ${command || "unknown command"}`;
  }
  return `Allow this exact ${toolName} call once.`;
}

export type ApprovalResolution = Pick<
  ResolveApprovalParams,
  "decision" | "lease"
>;
