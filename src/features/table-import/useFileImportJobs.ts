import { useEffect, useRef, useState } from "react";
import { fileImportJobService as service } from "@/services/tauri/file-import-jobs.service";
import type { FileImportPreparationPage, PrepareTableImportJobRequest } from "@/services/tauri/types/resumableImport";
import { useResumableJobs } from "@/features/table-transfer/hooks/useResumableTransfer";

const jobsService = {
  ...service,
  prepare: async (request: PrepareTableImportJobRequest) => (await service.prepare(request)).job,
};
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function useFileImportJobs(open: boolean, projectId: string) {
  const controller = useResumableJobs(open, projectId, jobsService);
  const [pages, setPages] = useState<Record<string, FileImportPreparationPage>>({});
  const [selectedPreparation, setSelectedPreparation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [preparingImportId, setPreparingImportId] = useState("");
  const generation = useRef(0);
  const cursors = useRef([""]);
  const running = useRef(false);

  useEffect(() => {
    ++generation.current;
    cursors.current = [""];
    running.current = false;
    setPages({});
    setSelectedPreparation("");
    setError(null);
    setPollError(null);
    setNotice(null);
    setAction(null);
    setPreparingImportId("");
    return () => { ++generation.current; };
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const results = await Promise.all(cursors.current.map(async (cursor) =>
          [cursor, await service.preparations(projectId, cursor || null)] as const));
        if (alive) { setPages(Object.fromEntries(results)); setPollError(null); }
      } catch (cause) {
        if (alive) setPollError(message(cause));
      } finally {
        if (alive) timer = setTimeout(() => void refresh(), 1000);
      }
    }
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [open, projectId, revision]);

  const preparations = [...new Map(Object.values(pages).flatMap(page => page.preparations)
    .filter(prep => !controller.jobs.some(job => job.id === prep.id && job.reviewReady))
    .map(prep => [prep.id, prep])).values()];
  const preparation = preparations.find(prep => prep.id === selectedPreparation)
    ?? (!selectedPreparation && (!controller.job || !controller.job.reviewReady)
      ? preparations.find(prep => prep.id === controller.job?.id) ?? preparations[0] : undefined);
  const lastCursor = cursors.current[cursors.current.length - 1] ?? "";
  const nextCursor = pages[lastCursor]?.nextCursor;

  useEffect(() => {
    if (selectedPreparation && controller.jobs.some(job => job.id === selectedPreparation && job.reviewReady)) {
      controller.selectJob(selectedPreparation);
      setSelectedPreparation("");
    }
  }, [selectedPreparation, controller.jobs]);
  useEffect(() => {
    const pending = preparations.find(prep => prep.importId === preparingImportId);
    if (pending) setSelectedPreparation(pending.id);
  }, [preparingImportId, pages]);

  async function run(name: string, work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    const version = generation.current;
    setAction(name);
    setError(null);
    setNotice(null);
    try { await work(); }
    catch (cause) { if (version === generation.current) setError(message(cause)); }
    finally {
      if (version === generation.current) {
        running.current = false;
        setAction(null);
        setRevision(value => value + 1);
      }
    }
  }

  async function resumePreparation() {
    if (!preparation || preparation.active) return;
    const version = generation.current;
    await run("resume", async () => {
      const review = await service.resumePreparation(projectId, preparation.id);
      if (version !== generation.current) return;
      controller.adoptJob(review.job);
      setSelectedPreparation("");
    });
  }
  async function discardPreparation() {
    if (!preparation || preparation.active) return;
    await run("discard", () => service.discardPreparation(projectId, preparation.id));
  }
  // Cancellation must remain available while the long-running resume call waits.
  async function stopPreparation() {
    if (!preparation?.active) return;
    const version = generation.current;
    try {
      await service.cancelPreparation(preparation.importId);
      if (version === generation.current) setNotice("Cancellation requested. Waiting for private preparation data to be removed.");
    } catch (cause) { if (version === generation.current) setError(message(cause)); }
  }
  return {
    controller, preparations, preparation, error: error ?? pollError, notice, action,
    preparationsLoading: !pages[""] && !pollError,
    preparing: !!preparingImportId && controller.busy,
    selectPreparation: (id: string) => { setSelectedPreparation(id); setError(null); },
    selectJob: (id: string) => { setSelectedPreparation(""); controller.selectJob(id); setError(null); },
    prepare: async (request: PrepareTableImportJobRequest) => {
      const version = generation.current;
      setSelectedPreparation("");
      setPreparingImportId(request.importId);
      await controller.prepare(request);
      if (version === generation.current) {
        setPreparingImportId("");
        setRevision(value => value + 1);
      }
    },
    resumePreparation, discardPreparation, stopPreparation,
    hasMorePreparations: !!nextCursor,
    loadMorePreparations: () => {
      if (nextCursor && !cursors.current.includes(nextCursor)) {
        cursors.current.push(nextCursor);
        setRevision(value => value + 1);
      }
    },
  };
}
