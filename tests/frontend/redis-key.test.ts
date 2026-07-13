import { describe, expect, it } from "vitest";
import {
  buildRedisCreateKeyCommand,
  buildRedisKeyTree,
} from "@/lib/redisKey";

describe("Redis key creation commands", () => {
  it("builds each supported Redis key type", () => {
    expect(
      buildRedisCreateKeyCommand({
        name: "session:42",
        type: "string",
        value: "active",
        ttlSeconds: 60,
      })
    ).toBe('SET "session:42" "active"\nEXPIRE "session:42" 60');
    expect(
      buildRedisCreateKeyCommand({ name: "queue", type: "list", value: "a\nb" })
    ).toBe('RPUSH "queue" "a" "b"');
    expect(
      buildRedisCreateKeyCommand({ name: "roles", type: "set", value: "admin\nuser" })
    ).toBe('SADD "roles" "admin" "user"');
    expect(
      buildRedisCreateKeyCommand({
        name: "user:1",
        type: "hash",
        value: "name=Ada\nrole=admin",
      })
    ).toBe('HSET "user:1" "name" "Ada" "role" "admin"');
    expect(
      buildRedisCreateKeyCommand({
        name: "rank",
        type: "zset",
        value: "10 Ada\n20 Grace Hopper",
      })
    ).toBe('ZADD "rank" 10 "Ada" 20 "Grace Hopper"');
    expect(
      buildRedisCreateKeyCommand({
        name: "events",
        type: "stream",
        value: "event=created\nactor=admin",
      })
    ).toBe('XADD "events" * "event" "created" "actor" "admin"');
  });

  it("rejects invalid structured values and TTLs", () => {
    expect(() =>
      buildRedisCreateKeyCommand({ name: "hash", type: "hash", value: "invalid" })
    ).toThrow("field=value");
    expect(() =>
      buildRedisCreateKeyCommand({ name: "rank", type: "zset", value: "Ada" })
    ).toThrow("score member");
    expect(() =>
      buildRedisCreateKeyCommand({
        name: "key",
        type: "string",
        value: "value",
        ttlSeconds: 0,
      })
    ).toThrow("positive whole number");
  });
});

describe("Redis key hierarchy", () => {
  it("groups colon-delimited prefixes and keeps the final segment as the key", () => {
    const tree = buildRedisKeyTree([
      { name: "AA:BB:CC-ss", type: "string" },
      { name: "AA:BB:DD", type: "hash" },
      { name: "other", type: "string" },
    ]);

    expect(tree.map((node) => node.segment)).toEqual(["AA", "other"]);
    expect(tree[0]).toMatchObject({ segment: "AA", keyCount: 2 });
    expect(tree[0]?.children[0]).toMatchObject({ segment: "BB", keyCount: 2 });
    expect(tree[0]?.children[0]?.children).toMatchObject([
      { segment: "CC-ss", key: { name: "AA:BB:CC-ss" } },
      { segment: "DD", key: { name: "AA:BB:DD" } },
    ]);
    expect(tree[1]).toMatchObject({
      segment: "other",
      key: { name: "other" },
      keyCount: 1,
    });
  });
});
