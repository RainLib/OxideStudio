import { largeTransferService } from "@/services/tauri/large-transfer.service";
import type {
  LargeTransferCursor,
  LargeTransferPreview,
  LargeTransferSummary,
} from "@/services/tauri/types";
import { mergeTransferJobs } from "../model/largeTransferPolicy";
import { useEffect, useRef, useState } from "react";

type TransferService<T> = Omit<typeof largeTransferService, "prepare"> & {
  prepare: (request: T) => Promise<LargeTransferSummary>;
};

export function useResumableTransfer(open: boolean, projectId: string, onTransferred?: () => void) {
  return useResumableJobs(open, projectId, largeTransferService, onTransferred);
}

export function useResumableJobs<T>(
  open: boolean,
  projectId: string,
  service: TransferService<T>,
  onTransferred?: () => void,
) {
  const [jobs, setJobs] = useState<LargeTransferSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [review, setReview] = useState<LargeTransferPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [nextCursor, setNextCursor] = useState<LargeTransferCursor | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requestedAction, setRequestedAction] = useState<
    "pause" | "cancel" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const generation = useRef(0);
  const selected = useRef("");
  const olderLoaded = useRef(false);
  const notified = useRef(new Set<string>());
  const onCompleted = useRef(onTransferred);
  onCompleted.current = onTransferred;
  const job = jobs.find((item) => item.id === selectedId);

  function selectJob(id: string) {
    selected.current = id;
    setSelectedId(id);
    setRequestedAction(null);
    setError(null);
  }

  useEffect(() => {
    const version = ++generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    selected.current = "";
    olderLoaded.current = false;
    notified.current.clear();
    setJobs([]);
    setSelectedId("");
    setReview(null);
    setConfirmation("");
    setNextCursor(null);
    setLoading(true);
    setBusy(false);
    setRequestedAction(null);
    setError(null);
    setPollError(null);
    const alive = () => generation.current === version;
    async function refresh() {
      try {
        const page = await service.list(projectId);
        if (!alive()) return;
        if (
          selected.current &&
          !page.jobs.some((item) => item.id === selected.current)
        ) {
          page.jobs.push(
            await service.get(projectId, selected.current),
          );
        }
        if (!alive()) return;
        let completed = false;
        page.jobs.forEach((item) => {
          if (item.phase === "completed" && !notified.current.has(item.id)) {
            notified.current.add(item.id);
            completed = true;
          }
        });
        if (completed) onCompleted.current?.();
        setPollError(null);
        setJobs((previous) => mergeTransferJobs(previous, page.jobs));
        if (!olderLoaded.current) setNextCursor(page.nextCursor ?? null);
        if (!selected.current && page.jobs[0]) selectJob(page.jobs[0].id);
      } catch (cause) {
        if (alive())
          setPollError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive()) {
          setLoading(false);
          timer = setTimeout(() => void refresh(), 1000);
        }
      }
    }
    if (open && projectId) void refresh();
    else setLoading(false);
    return () => {
      ++generation.current;
      clearTimeout(timer);
    };
  }, [open, projectId]);

  useEffect(() => {
    let alive = true;
    setReview(null);
    setConfirmation("");
    if (open && job?.reviewReady) {
      void service
        .preview(projectId, job.id)
        .then((value) => {
          if (alive) setReview(value);
        })
        .catch((cause: unknown) => {
          if (alive)
            setError(cause instanceof Error ? cause.message : String(cause));
        });
    }
    return () => {
      alive = false;
    };
  }, [open, projectId, selectedId, job?.reviewReady, reviewRevision]);

  useEffect(() => {
    if (!job || !requestedAction) return;
    const settled =
      requestedAction === "pause"
        ? ["paused", "cancelled", "completed", "failed"].includes(job.phase)
        : ["cancelled", "completed"].includes(job.phase) ||
          job.issue === "cancellation_requires_review";
    if (settled) setRequestedAction(null);
  }, [job?.phase, job?.issue, requestedAction]);

  async function run(action: () => Promise<void>) {
    const version = generation.current;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (version === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }

  function adoptJob(value: LargeTransferSummary) {
    setJobs((previous) => mergeTransferJobs(previous, [value]));
    selectJob(value.id);
  }
  async function prepare(request: T) {
    const version = generation.current;
    await run(async () => {
      const value = await service.prepare(request);
      if (version !== generation.current) return;
      setJobs((previous) => mergeTransferJobs(previous, [value]));
      selectJob(value.id);
    });
  }
  async function start() {
    if (!job || !review || confirmation.trim() !== review.confirmationToken)
      return;
    const token = confirmation.trim();
    setConfirmation("");
    const version = generation.current;
    await run(async () => {
      const value = await service.start(
        projectId,
        job.id,
        token,
      );
      if (version === generation.current) {
        setJobs((previous) => mergeTransferJobs(previous, [value]));
      }
    });
  }
  async function requestAction(action: "pause" | "cancel") {
    if (!job) return;
    const version = generation.current;
    await run(async () => {
      await service[action](projectId, job.id);
      if (version === generation.current && selected.current === job.id)
        setRequestedAction(action);
    });
  }
  async function loadMore() {
    if (!nextCursor) return;
    const version = generation.current;
    await run(async () => {
      const page = await service.list(projectId, nextCursor);
      if (version !== generation.current) return;
      olderLoaded.current = true;
      setJobs((previous) => mergeTransferJobs(previous, page.jobs));
      setNextCursor(page.nextCursor ?? null);
    });
  }
  function reloadReview() {
    setError(null);
    setReviewRevision((value) => value + 1);
  }
  return {
    adoptJob,
    jobs,
    job,
    review,
    confirmation,
    setConfirmation,
    loading,
    busy,
    error: error ?? pollError,
    requestedAction,
    selectJob,
    prepare,
    start,
    requestAction,
    loadMore,
    reloadReview,
    hasMore: !!nextCursor,
  };
}
