import { useEffect } from "react";
import { findWorkbenchAction } from "@/lib/actions";
import { keybindingMatchesEvent } from "@/lib/keybindings";
import { useSettingsStore } from "@/store/useSettingsStore";

export function useShortcuts() {
  const keymap = useSettingsStore((state) => state.settings.keymap);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      for (const [actionId, bindings] of Object.entries(keymap)) {
        if (!bindings.some((binding) => keybindingMatchesEvent(binding, event))) {
          continue;
        }
        if (
          isTextInput &&
          ![
            "commandPalette.open",
            "settings.open",
            "query.run",
            "query.runCurrentStatement",
            "query.format",
            "file.save",
            "editor.inlineCompletion.trigger",
            "editor.inlineCompletion.accept",
            "editor.inlineCompletion.acceptNextWord",
            "editor.inlineCompletion.hide",
          ].includes(actionId)
        ) {
          return;
        }

        const action = findWorkbenchAction(actionId);
        if (!action) return;
        event.preventDefault();
        void action.run();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keymap]);
}
