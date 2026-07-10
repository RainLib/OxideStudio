import type { DatabaseDriver } from "@/services/tauri/types";
import {
  classifyAiQuerySafety,
  type AiQuerySafety,
} from "@/lib/querySafety";

export type SqlExecutionIntent = "read" | "write" | "destructive";

export interface SqlExecutionGateDecision {
  safety: AiQuerySafety;
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
  confirmationMessage?: string;
}

export function evaluateSqlExecutionIntent(options: {
  sql: string;
  driver?: DatabaseDriver | null;
  intent: SqlExecutionIntent;
  approved?: boolean;
}): SqlExecutionGateDecision {
  const { sql, driver, intent, approved = false } = options;
  const safety = classifyAiQuerySafety(sql, driver);

  if (!sql.trim()) {
    return deny(safety, "Query is empty");
  }

  if (intent === "read" && safety !== "read") {
    return deny(
      safety,
      "Read-only execution rejected a potentially mutating request"
    );
  }

  if (intent === "write") {
    if (safety === "read") {
      return deny(safety, "Mutation execution rejected a read-only request");
    }
    if (safety === "destructive") {
      return deny(safety, "Write execution rejected a destructive request");
    }
  }

  if (intent === "destructive" && safety !== "destructive") {
    return deny(safety, "Destructive execution only accepts destructive requests");
  }

  if (safety === "destructive" && !approved) {
    return {
      safety,
      allowed: false,
      requiresApproval: true,
      reason: "Destructive SQL requires explicit approval",
      confirmationMessage:
        "This query appears destructive and may delete data or schema objects. Execute it?",
    };
  }

  return {
    safety,
    allowed: true,
    requiresApproval: false,
  };
}

export function editorExecutionConfirmation(sql: string, driver?: DatabaseDriver | null) {
  const decision = evaluateSqlExecutionIntent({
    sql,
    driver,
    intent: "destructive",
  });

  if (decision.safety !== "destructive") {
    return { required: false, message: null };
  }

  return {
    required: true,
    message:
      decision.confirmationMessage ||
      "This query appears destructive. Execute it?",
  };
}

function deny(safety: AiQuerySafety, reason: string): SqlExecutionGateDecision {
  return {
    safety,
    allowed: false,
    requiresApproval: false,
    reason,
  };
}
