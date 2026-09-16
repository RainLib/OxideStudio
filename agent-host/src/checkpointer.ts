import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import {
  SIDECAR_METHODS,
  graphCheckpointRecordSchema,
  type GraphCheckpointRecord,
  type GraphPendingWrite,
  type GraphTypedBlob,
} from "@oxide/agent-contract";
import type { TurnExecution } from "./runtime/execution.js";

const STORAGE_RPC_TIMEOUT_MS = 5_000;
const MAX_LIST_RECORDS = 1_000;

/**
 * LangGraph checkpointer backed by Rust's project-scoped encrypted store.
 * The sidecar serializes values using LangGraph's SerializerProtocol; Rust
 * treats the typed blobs as opaque authenticated payloads.
 */
export class OxideCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly execution: TurnExecution) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const scope = checkpointScope(config, false);
    const response = await this.execution.peer.call<unknown>(
      SIDECAR_METHODS.graphCheckpointGet,
      {
        ...this.storageMetadata("graph-checkpoint-get"),
        projectId: this.execution.params.projectId,
        checkpointThreadId: scope.threadId,
        checkpointNs: scope.checkpointNs,
        checkpointId: scope.checkpointId ?? null,
      },
      this.storageTimeout(),
    );
    const record = responseRecord(response);
    return record ? await this.deserializeRecord(record) : undefined;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const scope = checkpointScope(config, false);
    const beforeCheckpointId = checkpointId(options?.before);
    const requestedLimit = options?.limit;
    if (requestedLimit !== undefined && requestedLimit <= 0) return;
    const response = await this.execution.peer.call<unknown>(
      SIDECAR_METHODS.graphCheckpointList,
      {
        ...this.storageMetadata("graph-checkpoint-list"),
        projectId: this.execution.params.projectId,
        checkpointThreadId: scope.threadId,
        checkpointNs: scope.checkpointNs,
        checkpointId: scope.checkpointId ?? null,
        beforeCheckpointId: beforeCheckpointId ?? null,
        // Metadata filtering happens after authenticated deserialization.
        limit: options?.filter
          ? MAX_LIST_RECORDS
          : Math.min(MAX_LIST_RECORDS, requestedLimit ?? MAX_LIST_RECORDS),
        filter: options?.filter ?? null,
      },
      this.storageTimeout(),
    );
    const records = responseRecords(response);
    let yielded = 0;
    for (const record of records) {
      const tuple = await this.deserializeRecord(record);
      if (!matchesMetadata(tuple.metadata, options?.filter)) continue;
      yield tuple;
      yielded += 1;
      if (requestedLimit !== undefined && yielded >= requestedLimit) break;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const scope = checkpointScope(config, true);
    const [checkpointBlob, metadataBlob] = await Promise.all([
      this.serialize(copyCheckpoint(checkpoint)),
      this.serialize(metadata),
    ]);
    await this.execution.peer.call(
      SIDECAR_METHODS.graphCheckpointPut,
      {
        ...this.storageMetadata(`graph-checkpoint-put:${checkpoint.id}`),
        projectId: this.execution.params.projectId,
        checkpointThreadId: scope.threadId,
        checkpointNs: scope.checkpointNs,
        checkpointId: checkpoint.id,
        parentCheckpointId: scope.checkpointId ?? null,
        checkpoint: checkpointBlob,
        metadata: metadataBlob,
      },
      this.storageTimeout(),
    );
    return {
      configurable: {
        thread_id: scope.threadId,
        checkpoint_ns: scope.checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const scope = checkpointScope(config, true);
    if (!scope.checkpointId) {
      throw new Error(
        'Failed to put writes: configurable.checkpoint_id is required.',
      );
    }
    assertStorageIdentifier("task_id", taskId, false);
    const serializedWrites: GraphPendingWrite[] = await Promise.all(
      writes.map(async ([channel, value], index) => ({
        taskId,
        index: WRITES_IDX_MAP[channel] ?? index,
        channel,
        value: await this.serialize(value),
      })),
    );
    await this.execution.peer.call(
      SIDECAR_METHODS.graphCheckpointPutWrites,
      {
        ...this.storageMetadata(`graph-checkpoint-writes:${taskId}`),
        projectId: this.execution.params.projectId,
        checkpointThreadId: scope.threadId,
        checkpointNs: scope.checkpointNs,
        checkpointId: scope.checkpointId,
        writes: serializedWrites,
      },
      this.storageTimeout(),
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    assertStorageIdentifier("thread_id", threadId, false);
    await this.execution.peer.call(
      SIDECAR_METHODS.graphCheckpointDeleteThread,
      {
        ...this.storageMetadata("graph-checkpoint-delete-thread"),
        projectId: this.execution.params.projectId,
        checkpointThreadId: threadId,
      },
      this.storageTimeout(),
    );
  }

  private async serialize(value: unknown): Promise<GraphTypedBlob> {
    const [type, bytes] = await this.serde.dumpsTyped(value);
    return { type, data: Buffer.from(bytes).toString("base64") };
  }

  private async deserialize(blob: GraphTypedBlob): Promise<unknown> {
    return await this.serde.loadsTyped(blob.type, Buffer.from(blob.data, "base64"));
  }

  private async deserializeRecord(
    record: GraphCheckpointRecord,
  ): Promise<CheckpointTuple> {
    const [checkpoint, metadata, pendingWrites] = await Promise.all([
      this.deserialize(record.checkpoint) as Promise<Checkpoint>,
      this.deserialize(record.metadata) as Promise<CheckpointMetadata>,
      Promise.all(
        record.pendingWrites.map(async (write) => [
          write.taskId,
          write.channel,
          await this.deserialize(write.value),
        ] as [string, string, unknown]),
      ),
    ]);
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: record.checkpointThreadId,
          checkpoint_ns: record.checkpointNs,
          checkpoint_id: record.checkpointId,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (record.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: {
          thread_id: record.checkpointThreadId,
          checkpoint_ns: record.checkpointNs,
          checkpoint_id: record.parentCheckpointId,
        },
      };
    }
    return tuple;
  }

  private storageMetadata(suffix: string) {
    return this.execution.metadataFor(suffix);
  }

  private storageTimeout(): number {
    return Math.min(STORAGE_RPC_TIMEOUT_MS, this.execution.remainingMs());
  }
}

function checkpointScope(config: RunnableConfig, requireThread: boolean) {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || !threadId) {
    if (requireThread) {
      throw new Error(
        'Checkpoint config requires configurable.thread_id.',
      );
    }
    throw new Error('Checkpoint config has no configurable.thread_id.');
  }
  const checkpointNs = config.configurable?.checkpoint_ns ?? "";
  const resolvedCheckpointId = checkpointId(config);
  assertStorageIdentifier("thread_id", threadId, false);
  assertStorageIdentifier("checkpoint_ns", checkpointNs, true);
  if (resolvedCheckpointId) {
    assertStorageIdentifier("checkpoint_id", resolvedCheckpointId, false);
  }
  return { threadId, checkpointNs, checkpointId: resolvedCheckpointId };
}

function checkpointId(config: RunnableConfig | undefined): string | undefined {
  const value =
    config?.configurable?.checkpoint_id ?? config?.configurable?.thread_ts;
  return typeof value === "string" && value ? value : undefined;
}

function assertStorageIdentifier(
  field: string,
  value: unknown,
  allowEmpty: boolean,
): asserts value is string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value) ||
    value.length > 512
  ) {
    throw new Error(`Invalid checkpoint ${field}.`);
  }
}

function responseRecord(value: unknown): GraphCheckpointRecord | null {
  if (!isRecord(value) || value.record == null) return null;
  return graphCheckpointRecordSchema.parse(value.record);
}

function responseRecords(value: unknown): GraphCheckpointRecord[] {
  if (!isRecord(value) || !Array.isArray(value.records)) return [];
  return value.records.map((record) => graphCheckpointRecordSchema.parse(record));
}

function matchesMetadata(
  metadata: CheckpointMetadata | undefined,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  if (!metadata) return false;
  const values = metadata as Record<string, unknown>;
  return Object.entries(filter).every(
    ([key, value]) => JSON.stringify(values[key]) === JSON.stringify(value),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
