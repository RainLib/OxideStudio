import type { FunctionInfo } from "@/services/tauri/types";

export type RoutineKind = "function" | "procedure";

export function routineKind(routine: FunctionInfo): RoutineKind {
  return routine.routine_type?.trim().toLowerCase() === "procedure"
    ? "procedure"
    : "function";
}

export function routineKindLabel(routine: FunctionInfo) {
  return routineKind(routine) === "procedure" ? "proc" : "fn";
}

export function routineSignature(routine: FunctionInfo) {
  const parameters = (routine.parameters || [])
    .map((parameter) =>
      [parameter.name, parameter.data_type].filter(Boolean).join(" "),
    )
    .join(", ");
  return `${routine.name}(${parameters})`;
}

function routineParameterPlaceholders(routine: FunctionInfo) {
  return (routine.parameters || [])
    .map((parameter, index) => parameter.name?.trim() || `arg${index + 1}`)
    .join(", ");
}

/**
 * Generates a paste-ready, deliberately unquoted routine reference. Database
 * identifiers are kept visible so the user can adapt quoting to their dialect.
 */
export function routineCallTemplate(schema: string, routine: FunctionInfo) {
  const qualifiedName = schema ? `${schema}.${routine.name}` : routine.name;
  const parameters = routineParameterPlaceholders(routine);
  return routineKind(routine) === "procedure"
    ? `CALL ${qualifiedName}(${parameters});`
    : `SELECT ${qualifiedName}(${parameters});`;
}
