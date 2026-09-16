import type { ConnectionConfig } from "@/features/connections/model/types";
import { fieldClass, labelClass } from "@/features/connections/ui/connectionFormStyles";

interface ConnectionRocketMqFieldsProps {
  selectedConnection: ConnectionConfig;
  isRocketMq: boolean;
  updateRocketMq: (
    updates: Partial<NonNullable<ConnectionConfig["rocketMq"]>>,
  ) => void;
}

/** RocketMQ endpoint, cluster, and optional ACL fields. */
export function ConnectionRocketMqFields({
  selectedConnection,
  isRocketMq,
  updateRocketMq,
}: ConnectionRocketMqFieldsProps) {
  if (!isRocketMq) return null;

  return (
    <>
      <label className={labelClass} htmlFor="rocketmq-namesrv">
        NameServer
      </label>
      <div>
        <input
          id="rocketmq-namesrv"
          value={selectedConnection.rocketMq?.namesrvAddr || ""}
          onChange={(event) =>
            updateRocketMq({ namesrvAddr: event.target.value })
          }
          className={fieldClass}
          placeholder="127.0.0.1:9876; 127.0.0.2:9876"
          autoComplete="off"
        />
        <p className="mt-1 text-[10px] wb-muted">
          One or more NameServer host:port endpoints, separated by commas or
          semicolons.
        </p>
      </div>
      <label className={labelClass} htmlFor="rocketmq-cluster">
        Cluster name
      </label>
      <input
        id="rocketmq-cluster"
        value={selectedConnection.rocketMq?.clusterName || ""}
        onChange={(event) =>
          updateRocketMq({ clusterName: event.target.value || undefined })
        }
        className={fieldClass}
        placeholder="Optional, e.g. DefaultCluster"
        autoComplete="off"
      />
      <label className={labelClass} htmlFor="rocketmq-access-key">
        Access Key
      </label>
      <input
        id="rocketmq-access-key"
        value={selectedConnection.rocketMq?.accessKey || ""}
        onChange={(event) =>
          updateRocketMq({ accessKey: event.target.value || undefined })
        }
        className={fieldClass}
        placeholder="Optional ACL access key"
        autoComplete="username"
      />
      <label className={labelClass} htmlFor="rocketmq-secret-key">
        Secret Key
      </label>
      <input
        id="rocketmq-secret-key"
        type="password"
        value={selectedConnection.rocketMq?.secretKey || ""}
        onChange={(event) =>
          updateRocketMq({ secretKey: event.target.value || undefined })
        }
        className={fieldClass}
        placeholder="Optional ACL secret key"
        autoComplete="new-password"
      />
    </>
  );
}
