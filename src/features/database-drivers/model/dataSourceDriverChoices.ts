import type { DatabaseDriverProfile } from "@/lib/databaseDialect";
import type {
  DatabaseDriver,
  DatabaseDriverInstallation,
} from "@/services/tauri/types";
import {
  REFERENCE_DATABASE_DRIVER_CANDIDATES,
  driverCandidateAvailability,
  type DatabaseDriverCandidate,
} from "./referenceDriverCatalog";

export type DataSourceDriverAvailability =
  | "available"
  | "activationRequired"
  | "installationRequired";

export type DataSourceDriverChoice = {
  driver: DatabaseDriver;
  label: string;
  dataModel: DatabaseDriverCandidate["dataModel"] | "relational";
  availability: DataSourceDriverAvailability;
  searchText: string;
};

function normalizedDriverId(driver: string) {
  return driver.trim().toLowerCase();
}

function candidateAvailability(
  candidate: DatabaseDriverCandidate,
  installations: readonly DatabaseDriverInstallation[],
): DataSourceDriverAvailability {
  if (driverCandidateAvailability(candidate, installations) !== "requiresPackage") {
    return "available";
  }

  const hasReadyInactivePackage = installations.some(
    (installation) =>
      normalizedDriverId(installation.driver) === candidate.driver &&
      installation.distribution === "external" &&
      installation.status === "ready" &&
      installation.runtimeReady !== false,
  );
  return hasReadyInactivePackage ? "activationRequired" : "installationRequired";
}

/**
 * The new-source picker is intentionally broader than the executable profile
 * list: people should be able to find every planned product first, then see
 * the exact package state on the connection page. Only an active runtime is
 * marked available; catalogue visibility never grants a connection capability.
 */
export function dataSourceDriverChoices(
  profiles: readonly DatabaseDriverProfile[],
  installations: readonly DatabaseDriverInstallation[],
): DataSourceDriverChoice[] {
  const profilesByDriver = new Map(
    profiles.map((profile) => [normalizedDriverId(profile.driver), profile]),
  );
  const choices = new Map<string, DataSourceDriverChoice>();

  for (const candidate of REFERENCE_DATABASE_DRIVER_CANDIDATES) {
    const profile = profilesByDriver.get(candidate.driver);
    const label = profile?.menuLabel || candidate.displayName;
    choices.set(candidate.driver, {
      driver: candidate.driver,
      label,
      dataModel: candidate.dataModel,
      availability: candidateAvailability(candidate, installations),
      searchText: `${label} ${candidate.displayName} ${candidate.driver}`.toLowerCase(),
    });
  }

  // A signed third-party runtime may not be part of the DBX reference
  // catalogue. It is executable, so keep it discoverable alongside the
  // reference inventory instead of silently dropping it from the picker.
  for (const profile of profiles) {
    const driver = normalizedDriverId(profile.driver);
    if (choices.has(driver)) continue;
    choices.set(driver, {
      driver: profile.driver,
      label: profile.menuLabel,
      dataModel: profile.capabilities.dataModel,
      availability: "available",
      searchText: `${profile.menuLabel} ${profile.driver}`.toLowerCase(),
    });
  }

  return [...choices.values()].sort((left, right) => {
    const availabilityOrder = (choice: DataSourceDriverChoice) =>
      choice.availability === "available" ? 0 : 1;
    const byAvailability = availabilityOrder(left) - availabilityOrder(right);
    return byAvailability || left.label.localeCompare(right.label);
  });
}

export function filterDataSourceDriverChoices(
  choices: readonly DataSourceDriverChoice[],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return normalizedQuery
    ? choices.filter((choice) => choice.searchText.includes(normalizedQuery))
    : choices;
}
