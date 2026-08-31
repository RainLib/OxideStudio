import { describe, expect, it } from "vitest";

import type { DatabaseCapabilities } from "@/services/tauri/types";

import { canConfigureUnquotedTransferTargetColumns } from "./tableDataTransferPolicy";

const capabilities = {
  supportsTableDataTransfer: true,
} as DatabaseCapabilities;

describe("table data transfer target identifier policy", () => {
  it("exposes unquoted target columns only to reviewed external Gauss products", () => {
    expect(
      canConfigureUnquotedTransferTargetColumns(
        "gaussdb",
        "external",
        capabilities,
      ),
    ).toBe(true);
    expect(
      canConfigureUnquotedTransferTargetColumns(
        "OpenGauss",
        "external",
        capabilities,
      ),
    ).toBe(true);
    expect(
      canConfigureUnquotedTransferTargetColumns(
        "postgres",
        "external",
        capabilities,
      ),
    ).toBe(false);
    expect(
      canConfigureUnquotedTransferTargetColumns(
        "gaussdb",
        "bundled",
        capabilities,
      ),
    ).toBe(false);
    expect(
      canConfigureUnquotedTransferTargetColumns("gaussdb", "external", {
        ...capabilities,
        supportsTableDataTransfer: false,
      }),
    ).toBe(false);
  });
});
