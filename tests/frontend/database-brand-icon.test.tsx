/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseBrandIcon,
  databaseBrandAssetFile,
  hasDatabaseBrandIcon,
} from "@/components/icons/DatabaseBrandIcon";
import { REFERENCE_DATABASE_DRIVER_CANDIDATES } from "@/features/database-drivers";

describe("database brand icons", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
  });

  it("covers every DBX reference and compatibility product without a generic fallback", () => {
    for (const candidate of REFERENCE_DATABASE_DRIVER_CANDIDATES) {
      expect(hasDatabaseBrandIcon(candidate.driver), candidate.driver).toBe(true);
      const asset = databaseBrandAssetFile(candidate.driver);
      if (asset) {
        expect(existsSync(resolve("public/database-icons", asset)), asset).toBe(true);
      }
    }
  });

  it("uses the copied product asset before the vector fallback", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<DatabaseBrandIcon driver="sqlserver" size={16} title="SQL Server" />);
    });

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/database-icons/sqlserver.svg");
    expect(image?.getAttribute("data-database-brand")).toBe("sqlserver");
    expect(databaseBrandAssetFile("cloudflare-d1")).toBe("cloudflare-d1.svg");
  });

  it("keeps an intentional vector brand for compatibility products without a DBX asset", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<DatabaseBrandIcon driver="timescaledb" size={16} />);
    });

    const icon = container.querySelector('[data-database-brand="timescaledb"]');
    expect(icon?.tagName.toLowerCase()).toBe("svg");
  });
});
