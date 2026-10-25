import type { AssistantTurn } from "@/ai/assistant/turns";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

interface AssistantClarificationDockProps {
  turn: AssistantTurn | null;
  contextFingerprint: string;
  onAnswer: (
    turnId: string,
    clarificationId: string,
    answers: Record<string, string>,
    contextFingerprint: string,
  ) => Promise<void>;
}

export function AssistantClarificationDock({
  turn,
  contextFingerprint,
  onAnswer,
}: AssistantClarificationDockProps) {
  const activeClarificationId = turn?.clarifications.find(
    (clarification) => !clarification.answer,
  )?.clarificationId;
  const questions = useMemo(
    () =>
      turn?.clarifications.filter(
        (clarification) =>
          clarification.clarificationId === activeClarificationId,
      ) ?? [],
    [activeClarificationId, turn?.clarifications],
  );
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setQuestionIndex(0);
    setAnswers(
      Object.fromEntries(
        questions
          .filter((question) => question.answer?.trim())
          .map((question) => [question.questionId, question.answer!.trim()]),
      ),
    );
  }, [activeClarificationId, questions]);

  const question = questions[Math.min(questionIndex, questions.length - 1)];
  if (!turn || !activeClarificationId || !question) return null;

  const context = question.context;
  const answer = answers[question.questionId] ?? "";
  const selectedOption = question.options.find(
    (option) => (option.value || option.label) === answer,
  );
  const freeTextAnswer = selectedOption ? "" : answer;
  const isLast = questionIndex === questions.length - 1;

  const answerCurrentQuestion = async (value: string) => {
    const normalizedValue = value.trim();
    if (!normalizedValue || isSubmitting) return;
    const nextAnswers = {
      ...answers,
      [question.questionId]: normalizedValue,
    };
    setAnswers(nextAnswers);
    if (!isLast) {
      setQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
      return;
    }
    if (
      !questions.every((candidate) =>
        Boolean(nextAnswers[candidate.questionId]?.trim()),
      )
    ) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onAnswer(
        turn.id,
        activeClarificationId,
        nextAnswers,
        contextFingerprint,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const setCurrentDraft = (value: string) => {
    setAnswers((current) => ({
      ...current,
      [question.questionId]: value,
    }));
  };

  return (
    <Popover open modal={false}>
      <PopoverAnchor asChild>
        <span
          className="pointer-events-none absolute inset-x-2 top-0 h-px"
          aria-hidden="true"
        />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[240px] max-w-[calc(100vw-16px)] overflow-hidden p-0"
        aria-label="Agent clarification"
        data-assistant-clarification-dock
      >
        <div
          className="flex min-h-8 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2.5"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <HelpCircle
            size={12}
            className="shrink-0 text-[hsl(var(--wb-accent))]"
          />
          <span className="min-w-0 flex-1 text-[10px] font-medium text-[hsl(var(--wb-text))]">
            Agent needs your input
          </span>
          {isSubmitting ? (
            <Loader2
              size={11}
              className="shrink-0 animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
              aria-label="Submitting answer"
            />
          ) : (
            <>
              <span className="shrink-0 text-[9px] tabular-nums text-[hsl(var(--wb-text-muted))]">
                {questionIndex + 1} / {questions.length}
              </span>
              <div
                className="flex items-center gap-0.5"
                aria-label="Clarification question navigation"
              >
                <button
                  type="button"
                  className="wb-icon-button h-5 w-5"
                  aria-label="Previous clarification question"
                  title="Previous question"
                  disabled={questionIndex === 0}
                  onClick={() => setQuestionIndex((current) => current - 1)}
                >
                  <ChevronLeft size={11} />
                </button>
                <button
                  type="button"
                  className="wb-icon-button h-5 w-5"
                  aria-label="Next clarification question"
                  title="Next question"
                  disabled={isLast || !answer.trim()}
                  onClick={() => setQuestionIndex((current) => current + 1)}
                >
                  <ChevronRight size={11} />
                </button>
              </div>
            </>
          )}
        </div>

        <div className="custom-scrollbar max-h-[min(300px,42vh)] overflow-y-auto px-2.5 py-2.5">
          {context && !isGenericResumeContext(context) && (
            <p className="mb-2 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
              {context}
            </p>
          )}
          <div className="text-[11px] font-medium leading-4 text-[hsl(var(--wb-text))]">
            {question.question}
          </div>

          {question.options.length > 0 && (
            <div
              className="mt-2 grid gap-1"
              role="radiogroup"
              aria-label={question.question}
            >
              {question.options.map((option) => {
                const value = option.value || option.label;
                const selected = answer === value;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(
                      "flex min-h-8 w-full items-start gap-2 rounded-[4px] border px-2 py-1.5 text-left text-[10px] transition-colors",
                      selected
                        ? "border-[hsl(var(--wb-accent)/0.65)] bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
                        : "border-[hsl(var(--wb-border-subtle))] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                    )}
                    disabled={isSubmitting}
                    onClick={() => void answerCurrentQuestion(value)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block">{option.label}</span>
                      {option.description && (
                        <span className="mt-0.5 block text-[9px] leading-3 opacity-75">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {question.allowFreeText && (
            <form
              className="mt-2 flex gap-1"
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void answerCurrentQuestion(freeTextAnswer);
              }}
            >
              <input
                value={freeTextAnswer}
                onChange={(event) => setCurrentDraft(event.target.value)}
                className="wb-field min-w-0 flex-1 text-[10px]"
                placeholder="Or type an answer · Enter to continue"
                aria-label="Clarification answer"
                disabled={isSubmitting}
              />
            </form>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function isGenericResumeContext(context: string) {
  const normalized = context
    .trim()
    .toLowerCase()
    .replace(/[.!。]+$/u, "");
  return (
    normalized === "your answer will resume this same turn" ||
    normalized === "your answer will resume the same turn"
  );
}
