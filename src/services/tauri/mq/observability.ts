import { invokeRawCommand } from "../client";
import type { RocketMqAcls, RocketMqProducers } from "./contracts";

export const rocketMqObservabilityService = {
  listAcls: (connectionId: string) =>
    invokeRawCommand<RocketMqAcls>("list_rocketmq_acls", { connectionId }),
  listProducers: (connectionId: string) =>
    invokeRawCommand<RocketMqProducers>("list_rocketmq_producers", {
      connectionId,
    }),
};
