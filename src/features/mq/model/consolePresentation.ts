export type ConsoleSection =
  | "overview"
  | "topics"
  | "groups"
  | "producers"
  | "acl";

export const sections: Array<{ id: ConsoleSection; label: string }> = [
  { id: "overview", label: "Cluster" },
  { id: "topics", label: "Topics" },
  { id: "groups", label: "Consumer groups" },
  { id: "producers", label: "Producers" },
  { id: "acl", label: "Access control" },
];

export function failureMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
