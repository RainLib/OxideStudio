import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { AppLocale } from "@/lib/appSettings";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  enUS,
  zhCN,
  type MessageKey,
  type MessageVariables,
} from "./messages";

export type ResolvedAppLocale = Exclude<AppLocale, "system">;

type I18nContextValue = {
  locale: ResolvedAppLocale;
  preference: AppLocale;
  t: (key: MessageKey, variables?: MessageVariables) => string;
};

function browserLocale(): string {
  return typeof navigator === "undefined" ? "en-US" : navigator.language;
}

export function resolveAppLocale(
  preference: AppLocale,
  systemLocale = browserLocale(),
): ResolvedAppLocale {
  if (preference !== "system") return preference;
  return systemLocale.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function translate(
  locale: ResolvedAppLocale,
  key: MessageKey,
  variables?: MessageVariables,
): string {
  const template = (locale === "zh-CN" ? zhCN : enUS)[key] ?? enUS[key];
  if (!variables) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name)
      ? String(variables[name])
      : match,
  );
}

const defaultLocale = resolveAppLocale("system");
const I18nContext = createContext<I18nContextValue>({
  locale: defaultLocale,
  preference: "system",
  t: (key, variables) => translate(defaultLocale, key, variables),
});

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const preference = useSettingsStore(
    (state) => state.settings.appearance.locale,
  );
  const uiFontSize = useSettingsStore(
    (state) => state.settings.appearance.uiFontSize,
  );
  const appearance = useSettingsStore((state) => state.settings.appearance);
  const locale = resolveAppLocale(preference);
  const t = useCallback(
    (key: MessageKey, variables?: MessageVariables) =>
      translate(locale, key, variables),
    [locale],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dataset.locale = locale;
    root.dataset.stylePreset = appearance.stylePreset;
    root.dataset.appearanceAccent = appearance.accent;
    root.dataset.appearanceFont = appearance.fontFamily;
    root.dataset.appearanceDensity = appearance.density;
    root.dataset.chromeGradient = appearance.chromeGradient;
    root.dataset.reduceMotion = String(appearance.reduceMotion);
    root.style.setProperty("--wb-ui-font-size", `${uiFontSize}px`);
    root.style.setProperty("--wb-ui-font-size-sm", `${uiFontSize - 1}px`);
    root.style.setProperty("--wb-ui-font-size-xs", `${uiFontSize - 2}px`);
    root.style.setProperty("--wb-ui-font-size-md", `${uiFontSize + 1}px`);
    root.style.setProperty("--wb-ui-font-size-lg", `${uiFontSize + 2}px`);
    return () => {
      delete root.dataset.locale;
      delete root.dataset.stylePreset;
      delete root.dataset.appearanceAccent;
      delete root.dataset.appearanceFont;
      delete root.dataset.appearanceDensity;
      delete root.dataset.chromeGradient;
      delete root.dataset.reduceMotion;
      root.style.removeProperty("--wb-ui-font-size");
      root.style.removeProperty("--wb-ui-font-size-sm");
      root.style.removeProperty("--wb-ui-font-size-xs");
      root.style.removeProperty("--wb-ui-font-size-md");
      root.style.removeProperty("--wb-ui-font-size-lg");
    };
  }, [appearance, locale, uiFontSize]);

  return (
    <I18nContext.Provider value={{ locale, preference, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
