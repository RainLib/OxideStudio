import type { DatabaseDriver } from "@/services/tauri/types";

export const ROUTINE_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
export const ROUTINE_SOURCE_MAX_CHARS = 5 * 1024 * 1024;
export const ROUTINE_SOURCE_MAX_ENTRIES = 256;

export type RoutineSourceEntry = {
  expiresAt: number;
  force: boolean;
  promise?: Promise<string[]>;
  value?: string[];
};

export type RoutineSourceIdentity = {
  projectId: string;
  connectionId: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
  schema: string;
  routine: string;
};

export type RoutineSourceInvalidationIdentity = Pick<
  RoutineSourceIdentity,
  "projectId" | "connectionId" | "driver"
> &
  Partial<
    Pick<
      RoutineSourceIdentity,
      | "driverPackageVersion"
      | "connectionDatabaseName"
      | "schema"
      | "routine"
    >
  >;
