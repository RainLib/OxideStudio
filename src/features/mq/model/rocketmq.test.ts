import { describe, expect, it } from "vitest";
import { normalizeRocketMqNameServers, validateRocketMqConnection } from "./rocketmq";

describe("RocketMQ connection model", () => {
  it("normalizes and de-duplicates NameServer endpoints", () => {
    expect(normalizeRocketMqNameServers(" 127.0.0.1:9876;[2001:db8::1]:9876,127.0.0.1:9876 ")).toEqual(["127.0.0.1:9876", "[2001:db8::1]:9876"]);
  });
  it("rejects URLs and incomplete ACL credentials", () => {
    expect(() => normalizeRocketMqNameServers("http://localhost:9876")).toThrow("host:port");
    expect(() => validateRocketMqConnection({ namesrvAddr: "localhost:9876", accessKey: "ak" })).toThrow("together");
  });
});
