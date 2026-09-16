import { AgentProtocolError } from "../rpc.js";
import { isRecord } from "./value.js";

export type ConnectionCandidate = {
  id: string;
  name: string;
  driver: string;
};

export function connectionSelection(
  error: unknown,
): { candidates: ConnectionCandidate[] } | null {
  if (!(error instanceof AgentProtocolError) || !isRecord(error.data)) {
    return null;
  }
  if (
    error.data.kind !== "connection_selection_required" ||
    !Array.isArray(error.data.candidates)
  ) {
    return null;
  }
  const candidates = error.data.candidates.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== "string" ||
      !candidate.id.trim() ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim() ||
      typeof candidate.driver !== "string" ||
      !candidate.driver.trim()
    ) {
      return [];
    }
    return [
      {
        id: candidate.id.trim(),
        name: candidate.name.trim(),
        driver: candidate.driver.trim(),
      },
    ];
  });
  return candidates.length >= 2 ? { candidates } : null;
}

export function selectedConnectionFromResolution(
  resolution: string,
  candidates: ConnectionCandidate[],
): string {
  let answer = "";
  try {
    const parsed = JSON.parse(resolution) as unknown;
    if (isRecord(parsed) && isRecord(parsed.answers)) {
      const value = parsed.answers.connectionId;
      if (typeof value === "string") answer = value.trim();
    }
  } catch {
    // askUser always returns JSON; the explicit error below is safer than
    // guessing if a stale checkpoint contains a malformed value.
  }
  const normalized = answer.toLowerCase();
  const matches = candidates.filter(
    (candidate) =>
      candidate.id === answer ||
      candidate.name.toLowerCase() === normalized ||
      candidate.driver.toLowerCase() === normalized,
  );
  if (matches.length !== 1) {
    throw new Error(
      "The selected database connection is invalid or ambiguous. Choose one listed connection.",
    );
  }
  return matches[0]!.id;
}
