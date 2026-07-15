import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  AgentProtocolError,
  ContentLengthDecoder,
  JsonRpcPeer,
  encodeContentLengthFrame,
} from "../src/rpc.js";

describe("Content-Length framing", () => {
  it("decodes split and coalesced frames", () => {
    const decoder = new ContentLengthDecoder();
    const first = encodeContentLengthFrame({ first: true });
    const second = encodeContentLengthFrame({ second: true });
    expect(decoder.push(first.subarray(0, 8))).toEqual([]);
    expect(
      decoder.push(Buffer.concat([first.subarray(8), second])),
    ).toEqual([{ first: true }, { second: true }]);
  });

  it("rejects oversized frames before allocating their payload", () => {
    const decoder = new ContentLengthDecoder(32);
    expect(() => decoder.push("Content-Length: 33\r\n\r\n")).toThrowError(
      expect.objectContaining<Partial<AgentProtocolError>>({
        code: "FRAME_TOO_LARGE",
      }),
    );
  });
});

describe("JsonRpcPeer", () => {
  it("routes bidirectional requests", async () => {
    const leftToRight = new PassThrough();
    const rightToLeft = new PassThrough();
    const left = new JsonRpcPeer(rightToLeft, leftToRight);
    const right = new JsonRpcPeer(leftToRight, rightToLeft);
    right.register("sum", (params) => {
      const input = params as { left: number; right: number };
      return input.left + input.right;
    });
    const leftRun = left.run();
    const rightRun = right.run();

    await expect(
      left.call<number>("sum", { left: 2, right: 3 }),
    ).resolves.toBe(5);

    left.close();
    right.close();
    leftToRight.end();
    rightToLeft.end();
    await Promise.allSettled([leftRun, rightRun]);
  });

  it("rejects an aborted call and notifies the host to cancel the RPC", async () => {
    const leftToRight = new PassThrough();
    const rightToLeft = new PassThrough();
    const left = new JsonRpcPeer(rightToLeft, leftToRight);
    const right = new JsonRpcPeer(leftToRight, rightToLeft);
    let cancelledId: string | undefined;
    right.register("slow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { late: true };
    });
    right.registerNotification("$/cancelRequest", (params) => {
      cancelledId = (params as { id?: string }).id;
    });
    const leftRun = left.run();
    const rightRun = right.run();
    const controller = new AbortController();
    const request = left.call("slow", {}, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cancelledId).toMatch(/^sidecar-/u);

    left.close();
    right.close();
    leftToRight.end();
    rightToLeft.end();
    await Promise.allSettled([leftRun, rightRun]);
  });
});
