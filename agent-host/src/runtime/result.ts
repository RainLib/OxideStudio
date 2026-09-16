import { agentCitationSchema, type AgentCitation } from "@oxide/agent-contract";
import { AgentProtocolError } from "../rpc.js";
import { isRecord } from "./value.js";

export function finalAnswer(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.messages)) {
    throw new AgentProtocolError("FINAL_ANSWER_MISSING");
  }
  for (let index = result.messages.length - 1; index >= 0; index -= 1) {
    const message = result.messages[index] as unknown;
    if (!isRecord(message)) continue;
    const type =
      typeof message._getType === "function"
        ? (message._getType as () => unknown)()
        : message.type;
    if (type !== "ai" && type !== "assistant") continue;
    const metadata = isRecord(message.response_metadata)
      ? message.response_metadata
      : {};
    if (
      metadata.lcSource === "summarization" ||
      metadata.lc_source === "summarization"
    ) {
      continue;
    }
    const content = message.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .flatMap((block) =>
          isRecord(block) && typeof block.text === "string" ? [block.text] : [],
        )
        .join("")
        .trim();
      if (text) return text;
    }
  }
  throw new AgentProtocolError("FINAL_ANSWER_MISSING");
}

export function resolveCitedAnswer(
  answer: string,
  availableCitations: readonly AgentCitation[],
): { content: string; citations: AgentCitation[] } {
  const available = new Map(
    availableCitations.slice(0, 64).map((citation) => [citation.id, citation]),
  );
  const cited: AgentCitation[] = [];
  const citationNumbers = new Map<string, number>();
  const content = answer.replace(
    /\[\[cite:([A-Za-z0-9:_-]{1,80})\]\]/gu,
    (_token, id: string) => {
      const citation = available.get(id);
      if (!citation) return "";
      let number = citationNumbers.get(id);
      if (number === undefined) {
        if (cited.length >= 8) return "";
        cited.push(citation);
        number = cited.length;
        citationNumbers.set(id, number);
      }
      return `[${number}]`;
    },
  );
  return { content: content.trim(), citations: cited };
}

export function citationEvidenceInResult(result: unknown): AgentCitation[] {
  const citations = new Map<string, AgentCitation>();
  const pending: unknown[] = [result];
  const visited = new Set<object>();
  let inspected = 0;
  while (pending.length > 0 && inspected < 20_000 && citations.size < 64) {
    inspected += 1;
    const value = pending.pop();
    if (typeof value === "string") {
      if (
        value.length <= 300_000 &&
        value.includes('"citations"') &&
        (value.trimStart().startsWith("{") || value.trimStart().startsWith("["))
      ) {
        try {
          pending.push(JSON.parse(value));
        } catch {
          // A normal model message can contain citation prose without being JSON.
        }
      }
      continue;
    }
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const parsed = agentCitationSchema.safeParse(value);
    if (parsed.success) citations.set(parsed.data.id, parsed.data);
    pending.push(...Object.values(value as Record<string, unknown>));
  }
  return [...citations.values()];
}

export function artifactReferencesInResult(result: unknown): string[] {
  const references = new Set<string>();
  const pending: unknown[] = [result];
  const visited = new Set<object>();
  let inspected = 0;
  while (pending.length > 0 && inspected < 20_000) {
    inspected += 1;
    const value = pending.pop();
    if (typeof value === "string") {
      for (const match of value.matchAll(
        /"artifactRef"\s*:\s*"(tool-result-[A-Za-z0-9_-]{1,200})"/gu,
      )) {
        references.add(match[1]!);
      }
      continue;
    }
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.artifactRef === "string" &&
      /^tool-result-[A-Za-z0-9_-]{1,200}$/u.test(record.artifactRef)
    ) {
      references.add(record.artifactRef);
    }
    pending.push(...Object.values(record));
  }
  return [...references];
}
