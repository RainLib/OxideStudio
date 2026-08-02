/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from "vitest";
import {
  dataGridMenuItemHint,
  focusRelativeDataGridMenuItem,
} from "@/features/data-grid";

function menuFixture() {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  for (const label of ["Copy", "Delete", "Export"]) {
    const wrapper = document.createElement("div");
    const button = document.createElement("button");
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    wrapper.append(button);
    menu.append(wrapper);
  }
  document.body.append(menu);
  return menu;
}

describe("data grid context menu keyboard navigation", () => {
  it("combines the action description and shortcut for compact hover help", () => {
    expect(
      dataGridMenuItemHint({
        id: "copy",
        label: "Copy",
        description: "Copy selected cells to the clipboard.",
        shortcut: "⌘C",
      }),
    ).toBe("Copy selected cells to the clipboard. Shortcut: ⌘C");
  });

  it("wraps through enabled commands with arrow navigation", () => {
    const menu = menuFixture();
    const items = menu.querySelectorAll<HTMLButtonElement>("button");
    items[0].focus();

    focusRelativeDataGridMenuItem(menu, items[0], "previous");
    expect(document.activeElement).toBe(items[2]);

    focusRelativeDataGridMenuItem(menu, items[2], "next");
    expect(document.activeElement).toBe(items[0]);
    menu.remove();
  });

  it("moves directly to the first and last commands", () => {
    const menu = menuFixture();
    const items = menu.querySelectorAll<HTMLButtonElement>("button");

    focusRelativeDataGridMenuItem(menu, items[1], "first");
    expect(document.activeElement).toBe(items[0]);
    focusRelativeDataGridMenuItem(menu, items[0], "last");
    expect(document.activeElement).toBe(items[2]);
    menu.remove();
  });
});
