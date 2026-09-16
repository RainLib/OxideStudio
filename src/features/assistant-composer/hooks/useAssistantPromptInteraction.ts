import type { AssistantPromptBoxProps } from "@/features/assistant-composer/model/promptTypes";
import {
  commandTokenKey,
  sameSlashCommandToken,
  slashCommandTokenAtCaret,
  type SlashCommandToken,
} from "@/features/assistant-composer/model/slashCommandToken";
import type { AiCliCommandInfo } from "@/services/tauri/ai.service";
import { useEffect, useRef, useState, type ComponentProps } from "react";

interface PromptInteractionOptions
  extends Pick<
    AssistantPromptBoxProps,
    "message" | "onMessageChange" | "onSubmit" | "commandOptions"
  > {
  canSubmit: boolean;
  contextLocked: boolean;
  modelPanelOpen: boolean;
  setModelPanelOpen: (open: boolean) => void;
}
export function useAssistantPromptInteraction({
  message,
  onMessageChange,
  onSubmit,
  commandOptions,
  canSubmit,
  contextLocked,
  modelPanelOpen,
  setModelPanelOpen,
}: PromptInteractionOptions) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isComposingRef = useRef(false);

  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  const [commandToken, setCommandToken] = useState<SlashCommandToken | null>(
    null,
  );

  const [isComposing, setIsComposing] = useState(false);

  const [dismissedCommandValue, setDismissedCommandValue] = useState<
    string | null
  >(null);

  const commandQuery = commandToken?.query;

  const commandSuggestions =
    commandQuery === undefined
      ? []
      : [...(commandOptions ?? [])]
          .filter((command) =>
            command.name.toLowerCase().includes(commandQuery),
          )
          .sort((left, right) => {
            const leftStarts = left.name.toLowerCase().startsWith(commandQuery);
            const rightStarts = right.name
              .toLowerCase()
              .startsWith(commandQuery);
            return leftStarts === rightStarts
              ? left.name.localeCompare(right.name)
              : leftStarts
                ? -1
                : 1;
          })
          .slice(0, 8);

  const commandMenuOpen =
    commandSuggestions.length > 0 &&
    !contextLocked &&
    !modelPanelOpen &&
    !isComposing &&
    dismissedCommandValue !== commandTokenKey(message, commandToken);

  const acceptCommand = (command: AiCliCommandInfo) => {
    const token = commandToken;
    if (!token) return;
    const replacement = `/${command.name}${command.argumentHint ? " " : ""}`;
    const nextMessage = `${message.slice(0, token.start)}${replacement}${message.slice(token.end)}`;
    const nextCaret = token.start + replacement.length;
    setDismissedCommandValue(null);
    setCommandToken(null);
    onMessageChange(nextMessage);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const refreshCommandToken = (
    textarea: HTMLTextAreaElement,
    value = textarea.value,
  ) => {
    if (isComposingRef.current) return;
    const nextToken = slashCommandTokenAtCaret(value, textarea.selectionStart);
    setCommandToken((current) =>
      sameSlashCommandToken(current, nextToken) ? current : nextToken,
    );
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Keep the textarea DOM-owned while an IME is composing. Re-applying the
    // controlled value on every pinyin/English composition update makes some
    // WebKit input methods move the composition range and insert spaces.
    if (!isComposingRef.current && textarea.value !== message) {
      textarea.value = message;
    }
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 60), 180);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 180 ? "auto" : "hidden";
  }, [message]);

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    const tokenKey = commandTokenKey(message, commandToken);
    if (dismissedCommandValue !== null && dismissedCommandValue !== tokenKey) {
      setDismissedCommandValue(null);
    }
  }, [commandToken, dismissedCommandValue, message]);
  const dismissCommands = () =>
    setDismissedCommandValue(commandTokenKey(message, commandToken));
  const textareaHandlers: Pick<
    ComponentProps<"textarea">,
    | "onChange"
    | "onFocus"
    | "onClick"
    | "onSelect"
    | "onCompositionStart"
    | "onCompositionEnd"
    | "onKeyDown"
  > = {
    onChange: (event) => {
      onMessageChange(event.target.value);
      if (isComposingRef.current) return;
      refreshCommandToken(event.currentTarget);
    },
    onFocus: (event) => {
      setModelPanelOpen(false);
      setDismissedCommandValue(null);
      refreshCommandToken(event.currentTarget);
    },
    onClick: (event) => refreshCommandToken(event.currentTarget),
    onSelect: (event) => refreshCommandToken(event.currentTarget),
    onCompositionStart: () => {
      isComposingRef.current = true;
      setIsComposing(true);
      setCommandToken(null);
    },
    onCompositionEnd: (event) => {
      isComposingRef.current = false;
      setIsComposing(false);
      onMessageChange(event.currentTarget.value);
      refreshCommandToken(event.currentTarget);
    },
    onKeyDown: (event) => {
      if (event.key === "Escape" && commandMenuOpen) {
        event.preventDefault();
        event.stopPropagation();
        setDismissedCommandValue(commandTokenKey(message, commandToken));
        return;
      }
      if (commandMenuOpen && !isComposingRef.current) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActiveCommandIndex((current) => {
            const direction = event.key === "ArrowDown" ? 1 : -1;
            return (
              (current + direction + commandSuggestions.length) %
              commandSuggestions.length
            );
          });
          return;
        }
        if (event.key === "Tab" || event.key === "Enter") {
          event.preventDefault();
          acceptCommand(
            commandSuggestions[activeCommandIndex] ?? commandSuggestions[0]!,
          );
          return;
        }
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !isComposingRef.current &&
        !event.nativeEvent.isComposing &&
        // WebKit reports keyCode 229 for the Enter event that commits an
        // IME candidate, even when isComposing has already flipped.
        event.keyCode !== 229
      ) {
        event.preventDefault();
        if (canSubmit) onSubmit();
      }
    },
  };
  return {
    textareaRef,
    commandMenuOpen,
    commandSuggestions,
    activeCommandIndex,
    setActiveCommandIndex,
    acceptCommand,
    dismissCommands,
    textareaHandlers,
  };
}
