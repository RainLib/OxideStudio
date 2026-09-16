/** A fixed Nacos OpenAPI configuration identity. This remains separate from
 * generic key-value commands because configuration migration is reviewed. */
export interface NacosConfigLocation {
  dataId: string;
  group: string;
  tenant?: string;
}

export interface NacosConfigTransferItem {
  source: NacosConfigLocation;
  target: NacosConfigLocation;
}

export type NacosConflictPolicy = "abort" | "skip" | "overwrite";

export interface NacosConfigTransferRequest {
  sourceConnectionId: string;
  targetConnectionId: string;
  items: NacosConfigTransferItem[];
  conflictPolicy?: NacosConflictPolicy;
}

export interface NacosConfigTransferPlanItem {
  source: NacosConfigLocation;
  target: NacosConfigLocation;
  status: "create" | "conflict";
  sourceContentDigest: string;
  targetContentDigest?: string;
}

export interface NacosConfigTransferPlan {
  total: number;
  creates: number;
  conflicts: number;
  items: NacosConfigTransferPlanItem[];
  confirmationPhrase?: string;
  confirmationToken: string;
}

export interface ExecuteNacosConfigTransferRequest {
  sourceConnectionId: string;
  targetConnectionId: string;
  items: NacosConfigTransferItem[];
  conflictPolicy?: NacosConflictPolicy;
  confirmationToken: string;
  confirmationPhrase?: string;
}

export interface NacosConfigTransferReceiptItem {
  target: NacosConfigLocation;
  status: "created" | "overwritten" | "skipped";
}

export interface NacosConfigTransferReceipt {
  created: number;
  overwritten: number;
  skipped: number;
  items: NacosConfigTransferReceiptItem[];
}
