import {
  AGENT_HOST_MAX_FRAME_BYTES,
  AGENT_HOST_PROTOCOL_VERSION,
  HOST_METHODS,
  SIDECAR_METHODS,
  type StartTurnParams,
} from "@oxide/agent-contract";
import { JsonRpcPeer } from "../../src/rpc.js";
export async function initializeRuntimeHost(host: JsonRpcPeer) {
  await host.call(HOST_METHODS.initialize, {
    protocolVersion: AGENT_HOST_PROTOCOL_VERSION,
    appVersion: "0.1.2",
    maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
    requiredCapabilities: ["agent", "model-proxy", "tool-proxy", "approval"],
  });
}

export function shellTurn(suffix: string): StartTurnParams {
  return {
    requestId: `request-shell-${suffix}`,
    threadId: `thread-shell-${suffix}`,
    turnId: `turn-shell-${suffix}`,
    contextVersion: "context-v1",
    deadline: Date.now() + 15_000,
    projectId: "project",
    profile: "agent",
    messages: [],
    prompt: "Run the requested command",
    provider: {
      model: "test-model",
      capabilities: {
        streaming: false,
        toolCalling: true,
        structuredOutput: false,
        maxInputTokens: 32_000,
        maxOutputTokens: 4_000,
      },
    },
    workspace: {
      projectId: "project",
      connectionId: null,
      database: null,
      namespace: null,
      activeTabId: null,
      configRevision: "revision",
      fingerprint: "fingerprint",
      summary: {},
    },
    tools: [
      {
        name: "shell.execute",
        description: "Execute one approved shell command",
        inputSchema: {
          type: "object",
          properties: {
            command: { type: "string" },
            sandboxMode: { type: "string" },
          },
          required: ["command"],
          additionalProperties: false,
        },
        permissions: ["external"],
      },
    ],
  };
}

export function registerGraphCheckpointMock(
  host: JsonRpcPeer,
  onWrite?: (raw: unknown) => void,
) {
  const records = new Map<string, Record<string, unknown>>();
  const key = (value: Record<string, unknown>, checkpointId: string) =>
    `${String(value.checkpointThreadId)}\u0000${String(value.checkpointNs ?? "")}\u0000${checkpointId}`;

  host.register(SIDECAR_METHODS.graphCheckpointGet, (raw) => {
    const params = raw as Record<string, unknown>;
    const prefix = `${String(params.checkpointThreadId)}\u0000${String(params.checkpointNs ?? "")}\u0000`;
    const requested =
      typeof params.checkpointId === "string" ? params.checkpointId : null;
    const record = requested
      ? records.get(key(params, requested))
      : [...records.entries()]
          .filter(([entryKey]) => entryKey.startsWith(prefix))
          .sort(([left], [right]) => right.localeCompare(left))[0]?.[1];
    return { record: record ?? null };
  });
  host.register(SIDECAR_METHODS.graphCheckpointList, (raw) => {
    const params = raw as Record<string, unknown>;
    const prefix = `${String(params.checkpointThreadId)}\u0000${String(params.checkpointNs ?? "")}\u0000`;
    return {
      records: [...records.entries()]
        .filter(([entryKey]) => entryKey.startsWith(prefix))
        .sort(([left], [right]) => right.localeCompare(left))
        .map(([, record]) => record),
    };
  });
  host.register(SIDECAR_METHODS.graphCheckpointPut, (raw) => {
    onWrite?.(raw);
    const params = raw as Record<string, unknown>;
    const checkpointId = String(params.checkpointId);
    records.set(key(params, checkpointId), {
      checkpointThreadId: params.checkpointThreadId,
      checkpointNs: params.checkpointNs ?? "",
      checkpointId,
      parentCheckpointId: params.parentCheckpointId ?? null,
      checkpoint: params.checkpoint,
      metadata: params.metadata,
      pendingWrites: [],
    });
    return { saved: true };
  });
  host.register(SIDECAR_METHODS.graphCheckpointPutWrites, (raw) => {
    onWrite?.(raw);
    const params = raw as Record<string, unknown>;
    const checkpointId = String(params.checkpointId);
    const record = records.get(key(params, checkpointId));
    if (record) {
      record.pendingWrites = [
        ...((record.pendingWrites as unknown[]) ?? []),
        ...((params.writes as unknown[]) ?? []),
      ];
    }
    return { saved: true };
  });
  host.register(SIDECAR_METHODS.graphCheckpointDeleteThread, () => ({
    deleted: 0,
  }));
}

export function serializedCheckpointText(frames: unknown[]): string {
  return frames
    .flatMap((frame) => {
      if (!frame || typeof frame !== "object") return [];
      const values = Object.values(frame as Record<string, unknown>);
      const writes = Array.isArray((frame as Record<string, unknown>).writes)
        ? (
            (frame as Record<string, unknown>).writes as Array<
              Record<string, unknown>
            >
          ).map((write) => write.value)
        : [];
      return [...values, ...writes];
    })
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const data = (value as Record<string, unknown>).data;
      if (typeof data !== "string") return [];
      return Buffer.from(data, "base64").toString("utf8");
    })
    .join("\n");
}
