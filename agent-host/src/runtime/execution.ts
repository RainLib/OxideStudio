import {
  SIDECAR_METHODS,
  type AgentCitation,
  type AgentEvent,
  type RequestMetadata,
  type ResumeInterrupt,
  type StartTurnParams,
} from "@oxide/agent-contract";
import { AgentProtocolError, type JsonRpcPeer } from "../rpc.js";
import { abortError, abortable } from "./cancellation.js";
import { type EventPayload, type ModelUsage } from "./events.js";
import { messageIdentifier, modelUsage } from "./messages.js";

export class TurnExecution {
  readonly controller = new AbortController();
  clarificationCount = 0;
  suspension: ResumeInterrupt | null = null;
  suspensionEvent: EventPayload | null = null;
  private eventSequence = 0;
  private mutationQueue = Promise.resolve();
  private readonly readOnlyWaiters: Array<() => void> = [];
  private readonly approvalLeases = new Map<string, string>();
  private readonly modelUsageByMessage = new Map<string, ModelUsage>();
  private readonly artifactReferences = new Set<string>();
  private readonly citationEvidence = new Map<string, AgentCitation>();
  private resumeConsumed = false;
  private modelUsageEmitted = false;
  private activeReadOnlyCalls = 0;
  task: Promise<void> | null = null;

  constructor(
    readonly peer: JsonRpcPeer,
    readonly params: StartTurnParams,
    readonly resume: ResumeInterrupt | null = null,
    transientApprovalLease?: { approvalId: string; lease: string } | null,
    initialArtifactReferences: readonly string[] = [],
    initialCitations: readonly AgentCitation[] = [],
  ) {
    for (const artifactRef of initialArtifactReferences) {
      this.recordArtifactReference(artifactRef);
    }
    this.recordCitations(initialCitations);
    if (transientApprovalLease) {
      this.approvalLeases.set(
        transientApprovalLease.approvalId,
        transientApprovalLease.lease,
      );
    }
  }

  metadataFor(suffix: string): RequestMetadata {
    return {
      requestId: `${this.params.requestId}:${suffix}`,
      threadId: this.params.threadId,
      turnId: this.params.turnId,
      contextVersion: this.params.contextVersion,
      deadline: this.params.deadline,
    };
  }

  remainingMs(): number {
    return Math.max(1, this.params.deadline - Date.now());
  }

  throwIfCancelled(): void {
    if (this.controller.signal.aborted) throw abortError();
    if (Date.now() >= this.params.deadline) {
      this.controller.abort("deadline");
      throw new AgentProtocolError("TURN_DEADLINE_EXCEEDED");
    }
  }

  async emit(payload: EventPayload): Promise<void> {
    const event = {
      ...payload,
      threadId: this.params.threadId,
      turnId: this.params.turnId,
      sequence: ++this.eventSequence,
      occurredAt: Date.now(),
    } as AgentEvent;
    await this.peer.notify(SIDECAR_METHODS.event, event);
  }

  observeModelUsage(
    message: Record<string, unknown>,
    metadata: Record<string, unknown>,
  ): void {
    const usage = modelUsage(message);
    if (!usage) return;
    const key = [
      metadata.langgraph_checkpoint_ns,
      metadata.langgraph_node,
      metadata.langgraph_step,
      messageIdentifier(message),
    ]
      .map((value) => String(value ?? ""))
      .join("\u0000");
    this.modelUsageByMessage.set(key, usage);
  }

  async emitModelUsage(): Promise<void> {
    if (this.modelUsageEmitted || this.modelUsageByMessage.size === 0) return;
    const usage = [...this.modelUsageByMessage.values()].reduce(
      (total, current) => ({
        inputTokens: total.inputTokens + current.inputTokens,
        outputTokens: total.outputTokens + current.outputTokens,
        totalTokens: total.totalTokens + current.totalTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
    this.modelUsageEmitted = true;
    await this.emit({
      type: "model.usage",
      calls: this.modelUsageByMessage.size,
      ...usage,
    });
  }

  recordArtifactReference(artifactRef: string | null): void {
    if (artifactRef) this.artifactReferences.add(artifactRef);
  }

  artifacts(): string[] {
    return [...this.artifactReferences];
  }

  recordCitations(citations: readonly AgentCitation[]): void {
    for (const citation of citations) {
      if (
        this.citationEvidence.size >= 64 &&
        !this.citationEvidence.has(citation.id)
      ) {
        break;
      }
      this.citationEvidence.set(citation.id, citation);
    }
  }

  citations(): AgentCitation[] {
    return [...this.citationEvidence.values()];
  }

  markSuspended(value: ResumeInterrupt, event: EventPayload | null): void {
    this.suspension = value;
    this.suspensionEvent = event;
  }

  clearSuspension(): void {
    this.suspension = null;
    this.suspensionEvent = null;
  }

  matchingResume<K extends ResumeInterrupt["kind"]>(
    kind: K,
  ): Extract<ResumeInterrupt, { kind: K }> | null {
    if (this.resumeConsumed || this.resume?.kind !== kind) return null;
    return this.resume as Extract<ResumeInterrupt, { kind: K }>;
  }

  markResumeConsumed(): void {
    this.resumeConsumed = true;
  }

  consumeApprovalLease(approvalId: string): string | null {
    const lease = this.approvalLeases.get(approvalId) ?? null;
    this.approvalLeases.delete(approvalId);
    return lease;
  }

  withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(operation, operation);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async withReadOnlyLimit<T>(operation: () => Promise<T>): Promise<T> {
    while (this.activeReadOnlyCalls >= 2) {
      await abortable(
        new Promise<void>((resolve) => this.readOnlyWaiters.push(resolve)),
        this.controller.signal,
      );
    }
    this.throwIfCancelled();
    this.activeReadOnlyCalls += 1;
    try {
      return await operation();
    } finally {
      this.activeReadOnlyCalls -= 1;
      this.readOnlyWaiters.shift()?.();
    }
  }

  cancel(reason = "cancelled"): void {
    if (this.controller.signal.aborted) return;
    this.controller.abort(reason);
  }
}
