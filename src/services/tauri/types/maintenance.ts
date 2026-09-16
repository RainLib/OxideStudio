export type DatabaseMaintenanceOperation =
  | "analyze"
  | "vacuum"
  | "vacuumAnalyze"
  | "vacuumFull"
  | "vacuumFullAnalyze"
  | "optimize";

export interface DatabaseMaintenanceRequest {
  database?: string;
  schema: string;
  table: string;
  operation: DatabaseMaintenanceOperation;
}

export interface DatabaseMaintenancePlan {
  operation: DatabaseMaintenanceOperation;
  target: string;
  summary: string;
  lockImpact: string;
  risk: "low" | "medium" | "high";
  requiresMaintenanceWindow: boolean;
  sqlPreview: string;
  confirmationText: string;
  confirmationToken: string;
  connectedDriver: string;
  serverVersion?: string | null;
}

export interface ExecuteDatabaseMaintenanceRequest {
  maintenance: DatabaseMaintenanceRequest;
  confirmationToken: string;
  confirmationText: string;
}
