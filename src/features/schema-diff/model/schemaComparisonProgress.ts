export type SchemaComparisonPhase =
  | "capture-target"
  | "compare-snapshots"
  | "open-review";

const phaseLabels: Record<SchemaComparisonPhase, string> = {
  "capture-target": "Reading live target metadata",
  "compare-snapshots": "Analyzing schema differences",
  "open-review": "Opening migration review",
};

const nextPhases: Record<SchemaComparisonPhase, SchemaComparisonPhase | null> = {
  "capture-target": "compare-snapshots",
  "compare-snapshots": "open-review",
  "open-review": null,
};

export function schemaComparisonPhaseLabel(phase: SchemaComparisonPhase) {
  return phaseLabels[phase];
}

export function schemaComparisonNextPhase(phase: SchemaComparisonPhase) {
  return nextPhases[phase];
}
