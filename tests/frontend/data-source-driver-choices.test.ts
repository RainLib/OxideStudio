import { describe, expect, it } from "vitest";
import {
  dataSourceDriverChoices,
  filterDataSourceDriverChoices,
} from "@/features/database-drivers";
import { supportedDatabaseDriverProfiles } from "@/lib/databaseDialect";

describe("data source driver choices", () => {
  it("keeps the full reference catalogue searchable while preserving runtime state", () => {
    const choices = dataSourceDriverChoices(
      supportedDatabaseDriverProfiles(),
      [],
    );

    expect(choices).toHaveLength(73);
    expect(choices.find((choice) => choice.driver === "postgres")).toMatchObject({
      availability: "available",
    });
    expect(choices.find((choice) => choice.driver === "oracle")).toMatchObject({
      label: "Oracle Database",
      availability: "installationRequired",
    });
    expect(filterDataSourceDriverChoices(choices, "oracle")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ driver: "oracle" }),
        expect.objectContaining({ driver: "oceanbase-oracle" }),
      ]),
    );
  });

  it("requires activation instead of treating a ready inactive package as connectable", () => {
    const choices = dataSourceDriverChoices(supportedDatabaseDriverProfiles(), [
      {
        driver: "oracle",
        displayName: "Oracle JDBC",
        clientLibrary: "ojdbc",
        clientVersion: "23.3",
        distribution: "external",
        updatePolicy: "independent",
        independentlyUpdatable: true,
        serverVersionPolicy: "declared-by-package",
        implementation: "isolated JDBC driver sidecar",
        packageVersion: "23.3.0",
        protocolVersion: "1.0",
        active: false,
        status: "ready",
        runtimeReady: true,
      },
    ]);

    expect(choices.find((choice) => choice.driver === "oracle")).toMatchObject({
      availability: "activationRequired",
    });
  });
});
