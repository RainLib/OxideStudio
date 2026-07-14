import type { UiActionRange } from "@/ai/ui-actions/types";

export const APP_EVENT_REVEAL_EDITOR_RANGE = "oxide:reveal-editor-range";

export type EditorRangeNavigationDetail = {
  tabId: string;
  range: UiActionRange;
  focus?: boolean;
};

export function requestEditorRangeReveal(
  detail: EditorRangeNavigationDetail
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<EditorRangeNavigationDetail>(
      APP_EVENT_REVEAL_EDITOR_RANGE,
      { detail }
    )
  );
}
