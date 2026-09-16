import type { RocketMqConnectionConfig } from "@/features/mq/model/rocketmq";
import { invokeCommand, invokeRawCommand } from "../client";
import type { RocketMqCluster } from "./contracts";

export const rocketMqConnectionService = {
  probeNameServers: (namesrvAddr: string) =>
    invokeCommand<{ endpoints: string[] }>("probe_rocketmq_nameservers", {
      namesrvAddr,
    }),
  connect: (connectionId: string, config: RocketMqConnectionConfig) =>
    invokeRawCommand<RocketMqCluster>("connect_rocketmq_workspace", {
      connectionId,
      config,
    }),
  testConnection: (config: RocketMqConnectionConfig) =>
    invokeRawCommand<RocketMqCluster>("test_rocketmq_workspace", { config }),
  getCluster: (connectionId: string) =>
    invokeRawCommand<RocketMqCluster>("get_rocketmq_cluster", { connectionId }),
  disconnect: (connectionId: string) =>
    invokeRawCommand<void>("disconnect_rocketmq_workspace", { connectionId }),
};
