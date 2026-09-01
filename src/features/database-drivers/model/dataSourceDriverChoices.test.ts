import { describe, expect, it } from "vitest";
import { supportedDatabaseDriverProfiles } from "@/lib/databaseDialect";
import { dataSourceDriverChoices } from "./dataSourceDriverChoices";

describe("data source driver choices", () => {
  it("surfaces bundled protocol-compatible DBX products as connectable", () => {
    const choices = dataSourceDriverChoices(
      supportedDatabaseDriverProfiles(),
      [],
    );

    for (const driver of [
      "cockroachdb",
      "easysearch",
      "greenplum",
      "tidb",
      "timescaledb",
      "yugabytedb",
    ]) {
      expect(choices).toContainEqual(
        expect.objectContaining({ driver, availability: "available" }),
      );
    }
  });

  it("does not promote an uninstalled signed-package product", () => {
    const choices = dataSourceDriverChoices(
      supportedDatabaseDriverProfiles(),
      [],
    );

    expect(choices).toContainEqual(
      expect.objectContaining({
        driver: "oracle",
        availability: "installationRequired",
      }),
    );
  });
});
