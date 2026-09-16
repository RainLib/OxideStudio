import type {
  SchemaChange,
  SchemaChangeRisk,
  SchemaConversionFeatureKind,
  SchemaMigrationStatus,
} from "@/services/tauri/types";

export const riskStyle: Record<
  SchemaChangeRisk,
  { rail: string; text: string; label: string }
> = {
  safe: {
    rail: "bg-emerald-400",
    text: "text-emerald-300",
    label: "Safe",
  },
  review: {
    rail: "bg-amber-400",
    text: "text-amber-300",
    label: "Review",
  },
  destructive: {
    rail: "bg-red-400",
    text: "text-red-300",
    label: "Destructive",
  },
};

export const conversionFeatureLabels: Record<
  SchemaConversionFeatureKind,
  string
> = {
  type: "Type",
  array: "Array",
  default: "Default",
  index: "Index",
  customType: "Custom type",
  schema: "Schema",
};

export function formatMigrationStatus(status: SchemaMigrationStatus) {
  switch (status) {
    case "verificationFailed":
      return "Verification failed";
    case "succeeded":
      return "Succeeded";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Rolled back";
    case "running":
      return "Running";
    case "interrupted":
      return "Interrupted — recapture required";
  }
}

export function migrationStatusStyle(status: SchemaMigrationStatus) {
  if (status === "succeeded") return "border-emerald-400/25 text-emerald-300";
  if (status === "running") return "border-sky-400/25 text-sky-300";
  if (status === "interrupted") return "border-red-400/25 text-red-300";
  if (status === "blocked") return "border-amber-400/25 text-amber-300";
  return "border-red-400/25 text-red-300";
}

export function statusTextStyle(status: SchemaMigrationStatus) {
  if (status === "succeeded") return "text-emerald-300";
  if (status === "running") return "text-sky-300";
  if (status === "interrupted") return "text-red-300";
  if (status === "blocked") return "text-amber-300";
  return "text-red-300";
}

export function formatPhase(phase: SchemaChange["phase"]) {
  return phase.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

export function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
