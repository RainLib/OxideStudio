export * from "./mq/contracts";

import { rocketMqConnectionService } from "./mq/connection";
import { rocketMqConsumerService } from "./mq/consumers";
import { rocketMqMessageService } from "./mq/messages";
import { rocketMqObservabilityService } from "./mq/observability";
import { rocketMqTopicService } from "./mq/topics";

/** Stable RocketMQ client composed from independently owned command groups. */
export const rocketMqService = {
  ...rocketMqConnectionService,
  ...rocketMqTopicService,
  ...rocketMqMessageService,
  ...rocketMqConsumerService,
  ...rocketMqObservabilityService,
};
