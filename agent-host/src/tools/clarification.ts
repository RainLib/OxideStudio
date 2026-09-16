import { DynamicStructuredTool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import {
  clarificationOptionSchema,
  clarificationQuestionSchema,
  type AnswerClarificationParams,
  type ClarificationQuestion,
} from "@oxide/agent-contract";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TurnExecution } from "../runtime/execution.js";
import { stableClarificationId, toolInvocationId } from "./identity.js";
import { isRecord } from "./value.js";

export const askUserQuestionInputSchema = clarificationQuestionSchema
  .omit({
    allowFreeText: true,
    options: true,
  })
  .extend({
    // The model-facing boundary is intentionally wider than the UI contract.
    // Some OpenAI-compatible models occasionally ignore maxItems=3. The host
    // normalizes those calls instead of failing the entire turn.
    options: z.array(clarificationOptionSchema).min(2).max(8),
  });

export function createAskUserTool(execution: TurnExecution) {
  return new DynamicStructuredTool({
    name: "ask_user",
    description:
      "Pause this turn and ask the user only when a material goal, scope, success criterion, connection, or safety constraint is ambiguous.",
    schema: z.object({
      // Whether free text is allowed is an OxideStudio UI policy, not a model
      // choice. Unknown legacy values are stripped by Zod and normalized below.
      questions: z.array(askUserQuestionInputSchema).min(1).max(6),
    }),
    func: async ({ questions }, _runManager, config) =>
      askUser(
        execution,
        normalizeClarificationQuestions(questions),
        toolInvocationId(config),
      ),
  });
}

export function normalizeClarificationQuestions(
  questions: Array<z.infer<typeof askUserQuestionInputSchema>>,
): ClarificationQuestion[] {
  return questions.slice(0, 3).map((question) => {
    const uniqueOptions = question.options.filter(
      (option, index, options) =>
        options.findIndex((candidate) => candidate.id === option.id) === index,
    );
    const withoutRedundantFreeText = uniqueOptions.filter(
      (option) => !isRedundantFreeTextOption(option.id, option.label),
    );
    const candidates =
      withoutRedundantFreeText.length >= 2
        ? withoutRedundantFreeText
        : uniqueOptions;

    return clarificationQuestionSchema.parse({
      ...question,
      options: candidates.slice(0, 3),
      allowFreeText: true,
    });
  });
}

export function isRedundantFreeTextOption(id: string, label: string): boolean {
  const normalizedId = id.trim().toLowerCase().replaceAll("-", "_");
  if (
    [
      "other",
      "others",
      "custom",
      "free_text",
      "freetext",
      "manual_input",
    ].includes(normalizedId)
  ) {
    return true;
  }

  const normalizedLabel = label.trim().toLowerCase();
  return (
    /^(?:其他|其它|自定义|手动输入)(?:$|[\s（(：:])/u.test(normalizedLabel) ||
    /^(?:other|others|something else|none of the above)(?:$|\b|\s|\()/u.test(
      normalizedLabel,
    )
  );
}

export async function askUser(
  execution: TurnExecution,
  questions: ClarificationQuestion[],
  invocationId?: string,
): Promise<string> {
  execution.throwIfCancelled();
  if (execution.clarificationCount >= 2) {
    throw new Error(
      "Clarification limit reached; make the safest reasonable assumption.",
    );
  }
  execution.clarificationCount += 1;
  const clarificationResume = execution.matchingResume("clarification");
  const clarificationId = clarificationResume
    ? clarificationResume.clarificationId
    : stableClarificationId(execution, invocationId ?? randomUUID());
  const payload = {
    kind: "clarification" as const,
    clarificationId,
    answers: {} as Record<string, string>,
  };
  execution.markSuspended(
    payload,
    clarificationResume
      ? null
      : {
          type: "clarification",
          clarificationId,
          questions,
          context: "Your answer will resume this same turn.",
        },
  );
  const resumed = interrupt(payload);
  execution.clearSuspension();
  execution.markResumeConsumed();
  const answers = clarificationAnswers(resumed, clarificationId);
  return JSON.stringify({ answers });
}

export function clarificationAnswers(
  value: unknown,
  clarificationId: string,
): Record<string, string> {
  if (
    !isRecord(value) ||
    value.kind !== "clarification" ||
    value.clarificationId !== clarificationId ||
    !isRecord(value.answers)
  ) {
    throw new Error("Clarification resume payload is invalid or stale.");
  }
  const answers = Object.fromEntries(
    Object.entries(value.answers).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  if (Object.keys(answers).length === 0) {
    throw new Error("Clarification resume payload has no answers.");
  }
  return answers;
}

export type ClarificationResolution = Pick<
  AnswerClarificationParams,
  "answers"
>;
