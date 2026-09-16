import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/services/tauri/mq.service.ts");

for (const [module, owner, commands] of [
  ["connection", "rocketMqConnectionService", ["connect", "getCluster", "disconnect"]],
  ["topics", "rocketMqTopicService", ["listTopics", "getTopicConfig", "getTopicStats"]],
  ["messages", "rocketMqMessageService", ["peekMessages", "queryMessagesByKey", "queryMessagesByTime"]],
  ["consumers", "rocketMqConsumerService", ["listConsumerGroups", "getConsumerGroup", "getConsumerLag"]],
  ["observability", "rocketMqObservabilityService", ["listAcls", "listProducers"]],
]) {
  const source = read(`src/services/tauri/mq/${module}.ts`);
  if (
    !facade.includes(owner) ||
    !source.includes('from "../client"') ||
    source.includes("mq.service") ||
    commands.some((command) => !source.includes(command))
  ) {
    throw new Error(`RocketMQ ${module} boundary is invalid.`);
  }
}

const contracts = read("src/services/tauri/mq/contracts.ts");
if (contracts.includes("invokeRawCommand") || !facade.includes('export * from "./mq/contracts";')) {
  throw new Error("RocketMQ IPC contracts must remain transport-free and public.");
}

console.log("RocketMQ client boundaries verified: contract, connection, topic, message, consumer, and observability owners are explicit.");
