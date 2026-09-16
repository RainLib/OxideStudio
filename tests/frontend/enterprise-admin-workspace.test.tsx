// @vitest-environment happy-dom
import { App } from "../../enterprise/admin-web/src/App";
import type { AdminOverview } from "../../enterprise/admin-web/src/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  createProject: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
  auditEvents: vi.fn(),
  token: "test-token",
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../../enterprise/admin-web/src/api", () => ({ adminApi: mocks }));
vi.mock("../../enterprise/admin-web/src/auth", () => ({
  adminAuth: {
    organizationId: () => "organization",
    accessToken: () => mocks.token,
    completeCallback: async () => false,
    signIn: mocks.signIn,
    signOut: mocks.signOut,
  },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const overview: AdminOverview = {
  organization: {
    id: "organization",
    displayName: "Test organization",
    minimumDesktopVersion: "0.1.18",
  },
  viewerRole: "owner",
  members: [
    {
      id: "member",
      displayName: "Alex",
      email: "alex@example.test",
      status: "active",
      role: "member",
    },
  ],
  projects: [],
  gateways: [],
  managedDevices: [],
};
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token = "test-token";
  mocks.overview.mockResolvedValue(overview);
  mocks.createProject.mockResolvedValue({});
  mocks.transferOrganizationOwnership.mockResolvedValue({});
  mocks.auditEvents.mockResolvedValue({ events: [] });
  localStorage.setItem("oxide.enterprise.admin.locale", "en-US");
  window.history.replaceState(null, "", "/#overview");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function navigate(section: string) {
  await act(async () => {
    window.history.replaceState(null, "", `/#${section}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
function projectInput() {
  return [...container.querySelectorAll("label")]
    .find((label) => label.textContent?.trim() === "Project name")
    ?.querySelector("input");
}
it("preserves an unsaved project form across section navigation and submits its current value", async () => {
  await act(async () => root.render(<App />));
  await navigate("projects");
  await click("New project");
  const input = projectInput()!;
  expect(input).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Analytics");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await navigate("members");
  expect(input.closest("section")?.hidden).toBe(true);
  await navigate("projects");
  expect(projectInput()?.value).toBe("Analytics");
  await act(async () =>
    input
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(mocks.createProject).toHaveBeenCalledWith("organization", "Analytics");
  expect(projectInput()).toBeUndefined();
  expect(mocks.overview).toHaveBeenCalledTimes(2);
});
it("preserves explicit confirmation before transferring organization ownership", async () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal("confirm", confirm);
  await act(async () => root.render(<App />));
  await navigate("members");
  await click("Make owner");
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Alex"));
  expect(mocks.transferOrganizationOwnership).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);
  await click("Make owner");
  expect(mocks.transferOrganizationOwnership).toHaveBeenCalledWith(
    "organization",
    "member",
  );
});
it("loads audit on navigation and removes the hash listener when unmounted", async () => {
  const remove = vi.spyOn(window, "removeEventListener");
  await act(async () => root.render(<App />));
  expect(mocks.auditEvents).not.toHaveBeenCalled();
  await navigate("audit");
  expect(mocks.auditEvents).toHaveBeenCalledWith("organization");
  await act(async () => root.render(null));
  expect(remove).toHaveBeenCalledWith("hashchange", expect.any(Function));
  await navigate("members");
  await navigate("audit");
  expect(mocks.auditEvents).toHaveBeenCalledTimes(1);
});
it("keeps organization resources behind sign-in", async () => {
  mocks.token = "";
  await act(async () => root.render(<App />));
  expect(container.querySelector(".navigation")).toBeNull();
  expect(mocks.overview).not.toHaveBeenCalled();
  await click("Sign in with Casdoor");
  expect(mocks.signIn).toHaveBeenCalledTimes(1);
});
