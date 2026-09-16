import type { ConnectionConfig } from "./types";
import type {
  RemoteSqliteSshConfig,
  SshTunnelConfig,
} from "@/services/tauri/types/connections";

export type UpdateConnectionField = (
  field: keyof ConnectionConfig,
  value: ConnectionConfig[keyof ConnectionConfig],
  invalidateUrl?: boolean,
) => void;

/** Draft values include defaults so controlled fields never receive undefined. */
export type ConnectionSshDraft = SshTunnelConfig &
  Required<
    Pick<
      SshTunnelConfig,
      "password" | "privateKeyPath" | "privateKeyPassphrase" | "jumpHosts"
    >
  >;
export type RemoteSqliteDraft = RemoteSqliteSshConfig & { workerPath: string };

export type FormSection = "general" | "ssl" | "advanced";

export type ConnectionStatus = {
  type: "success" | "error" | "loading";
  message: string;
  scope?: "connection" | "ssh";
} | null;
