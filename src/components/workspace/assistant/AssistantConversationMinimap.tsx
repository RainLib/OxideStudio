import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AssistantTurn } from "@/ai/assistant/turns";
import { assistantTurnAnswer } from "@/ai/assistant/turns";
import type { RefObject } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AssistantConversationEntry } from "./AssistantConversation";

interface AssistantConversationMinimapProps {
  entries?: AssistantConversationEntry[];
  turns?: AssistantTurn[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  contentVersion: string;
}

type ConversationAnchor = {
  id: string;
  question: string;
  answer: string;
};

type MarkerPosition = {
  id: string;
  ratio: number;
};

export function AssistantConversationMinimap({
  entries = [],
  turns,
  scrollContainerRef,
  contentVersion,
}: AssistantConversationMinimapProps) {
  const anchors = useMemo(
    () =>
      turns
        ? turns.map((turn) => ({
            id: turn.id,
            question: turn.userMessage,
            answer: assistantTurnAnswer(turn),
          }))
        : legacyEntryAnchors(entries),
    [entries, turns],
  );
  const [positions, setPositions] = useState<MarkerPosition[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || anchors.length < 4) return;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const containerRect = container.getBoundingClientRect();
      const scrollHeight = Math.max(container.scrollHeight, 1);
      const nodes = assistantAnchorNodes(container);
      const nextPositions = anchors.flatMap((anchor) => {
        const node = nodes.get(anchor.id);
        if (!node) return [];
        const rect = node.getBoundingClientRect();
        const documentTop = rect.top - containerRect.top + container.scrollTop;
        return [
          {
            id: anchor.id,
            ratio: Math.max(0.015, Math.min(0.985, documentTop / scrollHeight)),
          },
        ];
      });
      setPositions((current) =>
        sameMarkerPositions(current, nextPositions) ? current : nextPositions,
      );
      const nextActiveId = activeConversationAnchor(container, anchors, nodes);
      setActiveId((current) =>
        current === nextActiveId ? current : nextActiveId,
      );
    };
    const scheduleMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    container.addEventListener("scroll", scheduleMeasure, { passive: true });
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(container);
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(scheduleMeasure);
    mutationObserver?.observe(container, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      container.removeEventListener("scroll", scheduleMeasure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [anchors, contentVersion, scrollContainerRef]);

  if (anchors.length < 4) return null;
  const positionsById = new Map(
    positions.map((position) => [position.id, position.ratio]),
  );

  return (
    <TooltipProvider delayDuration={350}>
    <nav
      className="wb-assistant-minimap absolute bottom-3 left-1.5 top-3 z-20 w-7 select-none"
      aria-label="Conversation navigation"
    >
      <div className="absolute bottom-0 left-2 top-0 w-px bg-[hsl(var(--wb-border-subtle)/0.4)]" />
      {anchors.map((anchor, index) => {
        const ratio =
          positionsById.get(anchor.id) ??
          (anchors.length === 1 ? 0.5 : index / (anchors.length - 1));
        const active = anchor.id === activeId;
        return (
          <Tooltip key={anchor.id}>
          <TooltipTrigger asChild>
          <button
            type="button"
            className="group absolute left-0 flex h-4 w-7 -translate-y-1/2 items-center px-1.5 outline-none"
            style={{ top: `${ratio * 100}%` }}
            onClick={() =>
              scrollToConversationAnchor(scrollContainerRef.current, anchor.id)
            }
            aria-label={`Jump to turn: ${compact(anchor.question, 80)} Answer: ${compact(anchor.answer, 80)}`}
            aria-current={active ? "location" : undefined}
          >
            <span
              className={cn(
                "block h-[2px] w-2 rounded-full bg-[hsl(var(--wb-text-muted)/0.48)] opacity-75 transition-[width,opacity,transform,background-color] duration-300 ease-out group-hover:w-5 group-hover:translate-x-0.5 group-hover:bg-[hsl(var(--wb-text-muted)/0.82)] group-hover:opacity-100 group-focus-visible:w-5 group-focus-visible:opacity-100",
                active &&
                  "h-[3px] w-4 bg-[hsl(var(--wb-text-muted)/0.9)] opacity-100",
              )}
            />
          </button>
          </TooltipTrigger>
            <TooltipContent side="right" className="w-[min(340px,calc(100vw-16px))] px-2.5 py-2 text-left">
              <span className="block text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
                Question
              </span>
              <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-[hsl(var(--wb-text))]">
                {compact(anchor.question, 180)}
              </span>
              <span className="mt-2 block text-[9px] font-medium text-[hsl(var(--wb-text-muted))]">
                Answer
              </span>
              <span className="mt-1 block line-clamp-3 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {compact(anchor.answer, 240)}
              </span>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
    </TooltipProvider>
  );
}

function legacyEntryAnchors(entries: AssistantConversationEntry[]) {
  const anchors: ConversationAnchor[] = [];
  for (const entry of entries) {
    if (entry.status === "process") continue;
    if (entry.role === "user") {
      anchors.push({
        id: entry.id,
        question: entry.content,
        answer: "Waiting for an answer",
      });
      continue;
    }
    const active = anchors[anchors.length - 1];
    if (active && active.answer === "Waiting for an answer") {
      active.answer = entry.content;
    }
  }
  return anchors;
}

function assistantAnchorNodes(container: HTMLDivElement) {
  const nodes = new Map<string, HTMLElement>();
  container
    .querySelectorAll<HTMLElement>(
      "[data-assistant-turn-id], [data-assistant-entry-id]",
    )
    .forEach((node) => {
      const id = node.dataset.assistantTurnId || node.dataset.assistantEntryId;
      if (id && !nodes.has(id)) nodes.set(id, node);
    });
  return nodes;
}

function activeConversationAnchor(
  container: HTMLDivElement,
  anchors: ConversationAnchor[],
  nodes: Map<string, HTMLElement>,
) {
  const containerRect = container.getBoundingClientRect();
  const threshold = container.scrollTop + container.clientHeight * 0.32;
  let active = anchors[0]?.id ?? null;
  for (const anchor of anchors) {
    const node = nodes.get(anchor.id);
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    const documentTop = rect.top - containerRect.top + container.scrollTop;
    if (documentTop > threshold) break;
    active = anchor.id;
  }
  return active;
}

function scrollToConversationAnchor(
  container: HTMLDivElement | null,
  anchorId: string,
) {
  if (!container) return;
  const node = assistantAnchorNodes(container).get(anchorId);
  if (!node) return;
  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const top =
    nodeRect.top -
    containerRect.top +
    container.scrollTop -
    Math.max(12, container.clientHeight * 0.16);
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  } else {
    container.scrollTop = Math.max(0, top);
  }
}

function compact(value: string, limit: number) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function sameMarkerPositions(
  current: MarkerPosition[],
  next: MarkerPosition[],
) {
  return (
    current.length === next.length &&
    current.every(
      (position, index) =>
        position.id === next[index]?.id && position.ratio === next[index]?.ratio,
    )
  );
}
