export const accessActions = [
  ["resourceDiscover", "Discover"],
  ["metadataRead", "Metadata"],
  ["queryRead", "Read query"],
] as const;

export const driverProfiles: Record<string, { label: string; model: string }> =
  {
    postgres: { label: "PostgreSQL", model: "Relational SQL" },
    postgresql: { label: "PostgreSQL", model: "Relational SQL" },
    mysql: { label: "MySQL", model: "Relational SQL" },
    mongodb: { label: "MongoDB", model: "Document database" },
    mongo: { label: "MongoDB", model: "Document database" },
    elasticsearch: { label: "Elasticsearch", model: "Search index" },
    elastic: { label: "Elasticsearch", model: "Search index" },
    redis: { label: "Redis", model: "Key-value store" },
  };

export type AdminSection =
  | "overview"
  | "members"
  | "projects"
  | "infrastructure"
  | "policies"
  | "audit";

export const sectionTitles: Record<AdminSection, string> = {
  overview: "Overview",
  members: "Members",
  projects: "Projects",
  infrastructure: "Infrastructure",
  policies: "Access policies",
  audit: "Audit",
};

export function sectionFromHash(): AdminSection {
  const hash = window.location.hash.slice(1);
  if (hash === "gateways") return "infrastructure";
  if (
    hash === "members" ||
    hash === "projects" ||
    hash === "infrastructure" ||
    hash === "policies" ||
    hash === "audit"
  ) {
    return hash;
  }
  return "overview";
}
