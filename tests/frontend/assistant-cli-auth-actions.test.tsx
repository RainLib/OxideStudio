/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssistantProviderSetup } from "@/components/workspace/assistant/AssistantProviderSetup";
import { useAssistantCliSetupStore } from "@/store/useAssistantCliSetupStore";

const mocks = vi.hoisted(() => ({ openUrl: vi.fn(), copy: vi.fn() }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let clipboard: PropertyDescriptor | undefined;
const url = "https://www.codebuddy.ai/login?platform=CLI&state=fixture-state";

beforeEach(() => {
  mocks.openUrl.mockReset().mockResolvedValue(undefined);
  mocks.copy.mockReset().mockResolvedValue(undefined);
  clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  useAssistantCliSetupStore.getState().reset();
});
async function render(browserUrl = url) {
  await act(async () => {
    root.render(<AssistantProviderSetup provider="codebuddy-cli" state={{ phase: "authorizing", message: "Waiting", browserUrl }}
      onInstall={() => {}} onAuthenticate={() => {}} onCancelAuthentication={() => {}} onRetry={() => {}} onOpenSettings={() => {}} />);
  });
}
function button(key: string) {
  const result = Array.from(container.querySelectorAll("button")).find(node => node.textContent === key);
  expect(result).toBeTruthy();
  return result!;
}

it("reopens or copies the active login link without exposing its query in the page", async () => {
  await render();
  expect(container.textContent).toContain("www.codebuddy.ai");
  expect(container.textContent).not.toContain("fixture-state");
  await act(async () => { button("assistant.setup.openSignIn").click(); await Promise.resolve(); });
  expect(mocks.openUrl).toHaveBeenCalledWith(url);
  await act(async () => { button("assistant.setup.copySignInLink").click(); await Promise.resolve(); });
  expect(mocks.copy).toHaveBeenCalledWith(url);
  expect(container.textContent).toContain("assistant.setup.signInLinkCopied");
});

it("keeps a copy fallback when opening the system browser fails", async () => {
  mocks.openUrl.mockRejectedValueOnce(new Error("opener unavailable"));
  await render();
  await act(async () => { button("assistant.setup.openSignIn").click(); await Promise.resolve(); });
  expect(container.textContent).toContain("assistant.setup.openSignInFailed");
  button("assistant.setup.copySignInLink");
});

it("does not offer unsafe provider-supplied links", async () => {
  for (const unsafe of ["javascript:alert(1)", "file:///tmp/login", "https://user:secret@example.invalid/login"]) {
    await render(unsafe);
    expect(container.textContent).not.toContain("assistant.setup.copySignInLink");
  }
  expect(mocks.openUrl).not.toHaveBeenCalled();
});

it("removes a login link from transient setup state when the session ends", () => {
  const store = useAssistantCliSetupStore.getState();
  store.updateSetup("codebuddy-cli", { phase: "authorizing", message: "Waiting", browserUrl: url });
  store.updateSetup("codebuddy-cli", current => ({ ...current, phase: "ready", message: "Ready" }));
  expect(useAssistantCliSetupStore.getState().setupByProvider["codebuddy-cli"]?.browserUrl).toBeUndefined();
});
