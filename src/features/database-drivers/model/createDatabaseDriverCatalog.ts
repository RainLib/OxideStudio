import { DATABASE_DRIVER_PROFILES } from "@/features/database-drivers/model/builtinProfiles";
import { bundledProtocolProfileForDriver } from "@/features/database-drivers/model/bundledProtocolProfiles";
import {
  cloneCapabilities,
  cloneDriverProfile,
  withRuntimeCapabilities,
} from "@/features/database-drivers/model/cloneDriverProfile";
import { capabilitiesKey } from "@/features/database-drivers/model/driverIdentity";
import { type DatabaseDriverProfile } from "@/features/database-drivers/model/driverProfileTypes";
import { fallbackDatabaseDriverProfile } from "@/features/database-drivers/model/fallbackDriverProfile";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
  DatabaseDriverInstallation,
  KnownDatabaseDriver,
} from "@/services/tauri/types";

/** Owns backend capabilities, installed profiles and the authoritative driver set. */
export function createDatabaseDriverCatalog() {
  const runtimeCapabilities = new Map<string, DatabaseCapabilities>();

  const runtimeDriverProfiles = new Map<string, DatabaseDriverProfile>();

  const externalRuntimeDriverKeys = new Set<string>();

  let authoritativeDriverKeys: Set<string> | null = null;

  function registerDatabaseCapabilities(
    capabilities: DatabaseCapabilities | DatabaseCapabilities[],
  ) {
    const values = Array.isArray(capabilities) ? capabilities : [capabilities];
    for (const value of values) {
      runtimeCapabilities.set(
        capabilitiesKey(value.driver),
        cloneCapabilities(value),
      );
    }
  }

  /**
   * Register the complete driver catalog advertised by the running backend.
   *
   * Individual capability lookups enrich one profile, but only the list command
   * is authoritative about which drivers can actually be created in this build.
   */
  function registerRuntimeDatabaseCatalog(
    capabilities: DatabaseCapabilities[],
  ) {
    registerDatabaseCapabilities(capabilities);
    authoritativeDriverKeys = new Set(
      capabilities.map((value) => capabilitiesKey(value.driver)),
    );
  }

  /**
   * Makes verified, active external packages selectable without pretending that
   * every possible package is a built-in driver. Package handshake capabilities
   * still gate operations at runtime; this profile only supplies the connection
   * form.
   */
  function syncExternalDatabaseDriverProfiles(
    installations: DatabaseDriverInstallation[],
  ) {
    for (const key of externalRuntimeDriverKeys) {
      runtimeDriverProfiles.delete(key);
    }
    externalRuntimeDriverKeys.clear();

    for (const installation of installations) {
      if (
        installation.distribution !== "external" ||
        installation.status !== "ready" ||
        !installation.active ||
        installation.runtimeReady === false ||
        !installation.driver.trim()
      ) {
        continue;
      }
      const profile = fallbackDatabaseDriverProfile(installation.driver);
      const declaredCapabilities = installation.capabilities
        ? cloneCapabilities(installation.capabilities)
        : profile.capabilities;
      const key = capabilitiesKey(installation.driver);
      runtimeDriverProfiles.set(key, {
        ...profile,
        menuLabel: installation.displayName || profile.menuLabel,
        connectionUrlTemplate: installation.connectionUrlTemplate,
        capabilities: {
          ...declaredCapabilities,
          displayName:
            installation.displayName || declaredCapabilities.displayName,
        },
      });
      externalRuntimeDriverKeys.add(key);
      authoritativeDriverKeys?.add(key);
    }
  }

  function resetRuntimeDatabaseCatalogForTests() {
    authoritativeDriverKeys = null;
    runtimeCapabilities.clear();
    for (const key of externalRuntimeDriverKeys) {
      runtimeDriverProfiles.delete(key);
    }
    externalRuntimeDriverKeys.clear();
  }

  function registerDatabaseDriverProfile(
    profile: DatabaseDriverProfile | DatabaseDriverProfile[],
  ) {
    const values = Array.isArray(profile) ? profile : [profile];
    for (const value of values) {
      const cloned = cloneDriverProfile(value);
      runtimeDriverProfiles.set(capabilitiesKey(cloned.driver), cloned);
    }
  }

  function databaseDriverProfile(driver: DatabaseDriver) {
    const key = capabilitiesKey(driver);
    // Some DBX products are protocol-compatible profiles backed by a bundled
    // base runtime (for example TiDB/MySQL and CockroachDB/PostgreSQL). Resolve
    // their form defaults before falling back to the deliberately inert generic
    // profile. The connection keeps its selected product id; only the reviewed
    // transport/capability baseline is shared.
    const bundledProtocolProfile = Object.values(DATABASE_DRIVER_PROFILES).find(
      (candidate) =>
        candidate.protocolAliases.some(
          (alias) => capabilitiesKey(alias) === key,
        ),
    );
    const profile = bundledProtocolProfileForDriver(
      runtimeDriverProfiles.get(key) ??
        DATABASE_DRIVER_PROFILES[key as KnownDatabaseDriver] ??
        bundledProtocolProfile ??
        fallbackDatabaseDriverProfile(driver),
      driver,
    );
    return withRuntimeCapabilities(profile, runtimeCapabilities.get(key));
  }

  function supportedDatabaseDriverProfiles() {
    const profiles = new Map<string, DatabaseDriverProfile>();
    for (const profile of Object.values(DATABASE_DRIVER_PROFILES)) {
      profiles.set(capabilitiesKey(profile.driver), profile);
    }
    for (const [key, profile] of runtimeDriverProfiles) {
      profiles.set(key, profile);
    }
    for (const [key, capabilities] of runtimeCapabilities) {
      if (!profiles.has(key)) {
        profiles.set(key, fallbackDatabaseDriverProfile(capabilities.driver));
      }
    }

    return Array.from(profiles.entries())
      .filter(
        ([key]) => !authoritativeDriverKeys || authoritativeDriverKeys.has(key),
      )
      .map(([, profile]) => databaseDriverProfile(profile.driver));
  }

  function supportedDatabaseDrivers() {
    return supportedDatabaseDriverProfiles().map((profile) => profile.driver);
  }

  function normalizeDatabaseDriverName(value: string): DatabaseDriver | null {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;

    for (const profile of supportedDatabaseDriverProfiles()) {
      if (
        profile.driver === normalized ||
        profile.protocolAliases.some(
          (alias) => alias.toLowerCase() === normalized,
        )
      ) {
        return profile.driver;
      }
    }
    return normalized as DatabaseDriver;
  }
  return {
    registerDatabaseCapabilities,
    registerRuntimeDatabaseCatalog,
    syncExternalDatabaseDriverProfiles,
    resetRuntimeDatabaseCatalogForTests,
    registerDatabaseDriverProfile,
    databaseDriverProfile,
    supportedDatabaseDriverProfiles,
    supportedDatabaseDrivers,
    normalizeDatabaseDriverName,
  };
}
