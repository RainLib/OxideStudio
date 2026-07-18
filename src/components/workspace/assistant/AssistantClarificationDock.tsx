import type { AssistantTurn } from "@/ai/assistant/turns";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
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
  const allAnswered = questions.every((candidate) =>
    Boolean(answers[candidate.questionId]?.trim()),
  );
  const isLast = questionIndex === questions.length - 1;

  const setCurrentAnswer = (value: string, advance = false) => {
    setAnswers((current) => ({
      ...current,
      [question.questionId]: value,
    }));
    if (advance && !isLast) {
      setQuestionIndex((current) => Math.min(current + 1, questions.length - 1));
    }
  };

  const submit = async () => {
    if (!allAnswered || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onAnswer(
        turn.id,
        activeClarificationId,
        answers,
        contextFingerprint,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      className="shrink-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2"
      aria-label="Agent clarification"
      data-assistant-clarification-dock
    >
      <div className="rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))]">
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
          <span className="shrink-0 text-[9px] tabular-nums text-[hsl(var(--wb-text-muted))]">
            {questionIndex + 1} / {questions.length}
          </span>
        </div>

        <div className="custom-scrollbar max-h-[min(300px,42vh)] overflow-y-auto px-2.5 py-2.5">
          {context && (
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
                    onClick={() => setCurrentAnswer(value, true)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block">{option.label}</span>
                      {option.description && (
                        <span className="mt-0.5 block text-[9px] leading-3 opacity-75">
                          {option.description}
                        </span>
                      )}
                    </span>
                    {selected && <Check size={11} className="mt-0.5 shrink-0" />}
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
                if (!answer.trim()) return;
                if (isLast && allAnswered) void submit();
                else setQuestionIndex((current) => current + 1);
              }}
            >
              <input
                value={freeTextAnswer}
                onChange={(event) => setCurrentAnswer(event.target.value)}
                className="wb-field min-w-0 flex-1 text-[10px]"
                placeholder={
                  selectedOption
                    ? "Or type a different answer"
                    : "Or type an answer"
                }
                aria-label="Clarification answer"
                disabled={isSubmitting}
              />
            </form>
          )}
        </div>

        <div className="flex items-center gap-1 border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
          <button
            type="button"
            className="wb-text-button h-6 px-1.5 text-[10px]"
            aria-label="Previous clarification question"
            disabled={questionIndex === 0 || isSubmitting}
            onClick={() => setQuestionIndex((current) => current - 1)}
          >
            <ChevronLeft size={11} />
            Back
          </button>
          <span className="flex-1" />
          {!isLast ? (
            <button
              type="button"
              className="wb-primary-button h-6 px-2 text-[10px]"
              disabled={!answer.trim() || isSubmitting}
              onClick={() => setQuestionIndex((current) => current + 1)}
            >
              Next
              <ChevronRight size={11} />
            </button>
          ) : (
            <button
              type="button"
              className="wb-primary-button h-6 px-2 text-[10px]"
              disabled={!allAnswered || isSubmitting}
              onClick={() => void submit()}
            >
              <Check size={11} />
              Confirm answers
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
