// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResumableTransferDialog } from "@/features/table-transfer/ui/ResumableTransferDialog";
import { useResumableTransfer } from "@/features/table-transfer/hooks/useResumableTransfer";
import { buildLargeTransferRequest } from "@/features/table-transfer/model/largeTransferPolicy";
import type {
  LargeTransferPreview,
  LargeTransferRequest,
  LargeTransferSummary,
  TableDataTransferRequest,
} from "@/services/tauri/types";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  preview: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("@/services/tauri/large-transfer.service", () => ({
  largeTransferService: api,
}));
const request: LargeTransferRequest = {
  projectId: "p",
  source: {
    connectionId: "source",
    driver: "sqlite",
    schema: "main",
    table: "items",
  },
  target: {
    connectionId: "target",
    driver: "sqlite",
    schema: "main",
    table: "items",
  },
  mode: "append",
  batchRows: 500,
};
function job(
  id = "one",
  phase: LargeTransferSummary["phase"] = "paused",
): LargeTransferSummary {
  return {
    ...request,
    id,
    phase,
    sourceRows: 12001,
    rowsStaged: 500,
    batches: 1,
    snapshotBytes: 1024 * 1024,
    reviewReady: true,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}
function review(value = job(), token = "MIGRATE ABC123"): LargeTransferPreview {
  return {
    job: value,
    confirmationToken: token,
    targetRowsBefore: 0,
    mappedColumns: [
      {
        source: "id",
        target: "id",
        sourceType: "INTEGER",
        targetType: "INTEGER",
      },
    ],
    skippedColumns: [],
    warnings: [
      "The private snapshot includes unselected tables. Existing target rows stay unchanged until publication.",
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useResumableTransfer>;
function Harness({ projectId = "p" }: { projectId?: string }) {
  state = useResumableTransfer(true, projectId);
  return null;
}
function button(text: string) {
  const element = [...document.body.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
async function input(value: string) {
  const field = document.body.querySelector<HTMLInputElement>(
    "#large-transfer-confirmation",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  api.list.mockResolvedValue({ jobs: [job()], nextCursor: null });
  api.preview.mockResolvedValue(review());
  api.get.mockResolvedValue(job());
  api.pause.mockResolvedValue(true);
  api.cancel.mockResolvedValue(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("saved native full transfers", () => {
  it("refreshes table data once when a transfer completed while its dialog was closed", async () => {
    api.list.mockResolvedValue({
      jobs: [job("done", "completed")],
      nextCursor: null,
    });
    const transferred = vi.fn();
    await act(async () =>
      root.render(
        <ResumableTransferDialog
          open
          projectId="p"
          request={null}
          onClose={vi.fn()}
          onBack={vi.fn()}
          onTransferred={transferred}
        />,
      ),
    );
    expect(transferred).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(transferred).toHaveBeenCalledOnce();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("allows a failed review to be retried without creating or starting a different transfer", async () => {
    api.preview
      .mockRejectedValueOnce(new Error("review temporarily unavailable"))
      .mockResolvedValue(review());
    await act(async () =>
      root.render(
        <ResumableTransferDialog
          open
          projectId="p"
          request={null}
          onClose={vi.fn()}
          onBack={vi.fn()}
        />,
      ),
    );
    expect(document.body.textContent).toContain(
      "review temporarily unavailable",
    );
    await act(async () => button("Reload review").click());
    expect(document.body.textContent).toContain("MIGRATE ABC123");
    expect(document.body.textContent).not.toContain(
      "review temporarily unavailable",
    );
    expect(api.prepare).not.toHaveBeenCalled();
    expect(api.start).not.toHaveBeenCalled();
  });

  it("clears a transient history error after the next successful poll", async () => {
    api.list
      .mockRejectedValueOnce(new Error("history temporarily unavailable"))
      .mockResolvedValue({ jobs: [job()], nextCursor: null });
    await act(async () => root.render(<Harness />));
    expect(state.error).toContain("history temporarily unavailable");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(state.error).toBeNull();
    expect(state.job?.id).toBe("one");
  });

  it("reopens a paused job without executing it and requires its exact phrase to resume", async () => {
    api.start.mockResolvedValue(job("one", "copying"));
    const close = vi.fn();
    await act(async () =>
      root.render(
        <ResumableTransferDialog
          open
          projectId="p"
          request={request}
          onClose={close}
          onBack={vi.fn()}
        />,
      ),
    );
    expect(document.body.textContent).toContain("12,001");
    expect(api.start).not.toHaveBeenCalled();
    expect(api.prepare).not.toHaveBeenCalled();
    expect(button("Resume full transfer").disabled).toBe(true);
    await input("wrong phrase");
    expect(button("Resume full transfer").disabled).toBe(true);
    await input("MIGRATE ABC123");
    expect(button("Resume full transfer").disabled).toBe(false);
    await act(async () => button("Resume full transfer").click());
    expect(api.start).toHaveBeenCalledWith("p", "one", "MIGRATE ABC123");
    await act(async () => button("Close").click());
    expect(close).toHaveBeenCalledOnce();
    expect(api.cancel).not.toHaveBeenCalled();
    expect(api.pause).not.toHaveBeenCalled();
  });

  it("drops a delayed review after selecting a different saved job", async () => {
    const old = deferred<LargeTransferPreview>();
    api.list.mockResolvedValue({
      jobs: [job("one"), job("two")],
      nextCursor: null,
    });
    api.preview.mockImplementation((_p: string, id: string) =>
      id === "one"
        ? old.promise
        : Promise.resolve(review(job("two"), "MIGRATE NEW456")),
    );
    await act(async () =>
      root.render(
        <ResumableTransferDialog
          open
          projectId="p"
          request={null}
          onClose={vi.fn()}
          onBack={vi.fn()}
        />,
      ),
    );
    const nav = document.body.querySelector(
      '[aria-label="Saved full transfers"]',
    )!;
    const choices = nav.querySelectorAll("button");
    // Equal timestamps sort descending by ID, so explicitly select each job.
    await act(async () => choices[1].click());
    await act(async () => choices[0].click());
    await act(async () => old.resolve(review(job("one"), "MIGRATE STALE")));
    expect(document.body.textContent).toContain("MIGRATE NEW456");
    expect(document.body.textContent).not.toContain("MIGRATE STALE");
  });

  it("keeps preparation scoped when the user changes projects before it returns", async () => {
    const pending = deferred<LargeTransferSummary>();
    api.prepare.mockReturnValue(pending.promise);
    api.list.mockImplementation((project: string) =>
      Promise.resolve({
        jobs: [{ ...job(project), projectId: project }],
        nextCursor: null,
      }),
    );
    await act(async () => root.render(<Harness />));
    let preparing!: Promise<void>;
    await act(async () => {
      preparing = state.prepare(request);
    });
    await act(async () => root.render(<Harness projectId="other" />));
    await act(async () => {
      pending.resolve(job("old-preparation", "preparing"));
      await preparing;
    });
    expect(state.jobs.map((value) => value.projectId)).toEqual(["other"]);
    expect(state.busy).toBe(false);
    expect(api.prepare).toHaveBeenCalledWith(request);
  });

  it("keeps older jobs reachable across polling and continues pagination from the older cursor", async () => {
    const cursor = { updatedAt: 1699999999999, id: "page-one" };
    api.list.mockImplementation((_p: string, page: unknown) =>
      Promise.resolve(
        page
          ? { jobs: [job("old")], nextCursor: null }
          : { jobs: [job("new")], nextCursor: cursor },
      ),
    );
    api.get.mockResolvedValue(job("old"));
    await act(async () => root.render(<Harness />));
    await act(async () => state.loadMore());
    expect(state.hasMore).toBe(false);
    await act(async () => state.selectJob("old"));
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(state.jobs.some((value) => value.id === "old")).toBe(true);
    expect(state.hasMore).toBe(false);
    expect(api.get).toHaveBeenCalledWith("p", "old");
    expect(api.list).toHaveBeenCalledWith("p", cursor);
  });

  it("shows accepted cancellation while allowing the dialog to close", async () => {
    api.list.mockResolvedValue({
      jobs: [job("one", "copying")],
      nextCursor: null,
    });
    const close = vi.fn();
    await act(async () =>
      root.render(
        <ResumableTransferDialog
          open
          projectId="p"
          request={null}
          onClose={close}
          onBack={vi.fn()}
        />,
      ),
    );
    await act(async () => button("Cancel transfer").click());
    expect(api.cancel).toHaveBeenCalledWith("p", "one");
    expect(document.body.textContent).toContain("Cancellation requested");
    expect(button("Pause after batch").disabled).toBe(true);
    await act(async () => button("Close").click());
    expect(close).toHaveBeenCalledOnce();
  });

  it("constructs a distinct full-copy request without inheriting the legacy row cap or schema options", () => {
    const legacy: TableDataTransferRequest = {
      ...request,
      transferId: "bounded",
      maxRows: 10,
      batchSize: 7,
      reseedIdentity: true,
      restoreSourceSchemaObjects: true,
    };
    const full = buildLargeTransferRequest(legacy, true);
    expect(full).toEqual(request);
    expect(full).not.toHaveProperty("maxRows");
    expect(full).not.toHaveProperty("reseedIdentity");
    expect(buildLargeTransferRequest(legacy, false)).toBeNull();
    expect(
      buildLargeTransferRequest(
        { ...legacy, target: { ...legacy.target, driver: "postgres" } },
        true,
      ),
    ).toBeNull();
  });
  it("allows matching native PostgreSQL endpoints and keeps unsupported adapters out", () => {
    const legacy: TableDataTransferRequest = {
      ...request,
      transferId: "bounded",
      maxRows: 10,
      source: { ...request.source, driver: "postgres", database: "source_analytics", schema: "public" },
      target: { ...request.target, driver: "postgres", database: "warehouse_db", schema: "warehouse" },
    };
    expect(buildLargeTransferRequest(legacy, true)?.source.driver).toBe(
      "postgres",
    );
    expect(buildLargeTransferRequest(legacy, false)).toBeNull();
    expect(
      buildLargeTransferRequest(
        { ...legacy, target: { ...legacy.target, schema: "pg_catalog" } },
        true,
      ),
    ).toBeNull();
    expect(
      buildLargeTransferRequest(
        {
          ...legacy,
          source: { ...legacy.source, driver: "mongodb" },
          target: { ...legacy.target, driver: "mongodb" },
        },
        true,
      ),
    ).toBeNull();
  });
  it("describes a selected PostgreSQL snapshot without claiming to copy the entire database", async () => {
    const postgresRequest: LargeTransferRequest = {
      ...request,
      source: {
        ...request.source,
        driver: "postgres",
        database: "source_analytics",
        schema: "public",
      },
      target: {
        ...request.target,
        driver: "postgres",
        database: "warehouse_db",
        schema: "warehouse",
      },
    };
    const prepared = {
      ...job("pg-preparing", "preparing"),
      ...postgresRequest,
      reviewReady: false,
    };
    api.list.mockResolvedValue({ jobs: [], nextCursor: null });
    api.prepare.mockResolvedValue(prepared);
    api.get.mockResolvedValue(prepared);
    await act(async () =>
      root.render(
        <ResumableTransferDialog
          open
          projectId="p"
          request={postgresRequest}
          onClose={vi.fn()}
          onBack={vi.fn()}
        />,
      ),
    );
    expect(document.body.textContent).toContain("selected PostgreSQL table");
    expect(document.body.textContent).toContain("source_analytics · public.items");
    expect(document.body.textContent).toContain("warehouse_db · warehouse.items");
    expect(document.body.textContent).not.toContain(
      "including unselected tables",
    );
    await act(async () => button("Prepare full snapshot").click());
    expect(api.prepare).toHaveBeenCalledWith(postgresRequest);
  });
  it("maps native MySQL selected databases and excludes system or mixed endpoints", () => {
    const legacy:TableDataTransferRequest={...request,transferId:"bounded",maxRows:10,source:{...request.source,driver:"mysql",schema:"",database:"sales"},target:{...request.target,driver:"mysql",schema:"",database:"archive"}};
    expect(buildLargeTransferRequest(legacy,true)?.source.schema).toBe("sales");
    expect(buildLargeTransferRequest(legacy,true)?.target.schema).toBe("archive");
    expect(buildLargeTransferRequest(legacy,false)).toBeNull();
    expect(buildLargeTransferRequest({...legacy,target:{...legacy.target,driver:"postgres"}},true)).toBeNull();
    for (const database of ["mysql","SYS","information_schema","performance_schema","ndbinfo"])
      expect(buildLargeTransferRequest({...legacy,target:{...legacy.target,database}},true)).toBeNull();
    expect(buildLargeTransferRequest({...legacy,target:{...legacy.target,table:"x".repeat(65)}},true)).toBeNull();
  });
  it("prepares only the selected MySQL table and names the database at final confirmation", async () => {
    const mysqlRequest:LargeTransferRequest={...request,source:{...request.source,driver:"mysql",schema:"sales",database:"sales"},target:{...request.target,driver:"mysql",schema:"archive",database:"archive"}};
    const mysqlJob={...job("mysql-ready","awaitingReview"),...mysqlRequest};
    api.list.mockResolvedValue({jobs:[mysqlJob],nextCursor:null});
    api.preview.mockResolvedValue(review(mysqlJob));
    api.prepare.mockResolvedValue({...mysqlJob,phase:"preparing",reviewReady:false});
    await act(async()=>root.render(<ResumableTransferDialog open projectId="p" request={mysqlRequest} onClose={vi.fn()} onBack={vi.fn()} />));
    expect(document.body.textContent).toContain("selected MySQL table");
    expect(document.body.textContent).toContain("InnoDB tables");
    expect(document.body.textContent).not.toContain("including unselected tables");
    expect(document.body.textContent).toContain("sales.items");
    expect(document.body.textContent).toContain("Confirm append to target · archive.items");
    expect(api.start).not.toHaveBeenCalled();
    await act(async()=>button("Prepare full snapshot").click());
    expect(api.prepare).toHaveBeenCalledWith(mysqlRequest);
  });
  it("clears a late pause acknowledgement after polling already observed paused", async () => {
    const accepted=deferred<boolean>();
    api.pause.mockReturnValue(accepted.promise);
    api.list.mockResolvedValue({jobs:[job("one","copying")],nextCursor:null});
    await act(async()=>root.render(<Harness />));
    let pending:Promise<void>;
    await act(async()=>{pending=state.requestAction("pause");});
    api.list.mockResolvedValue({jobs:[job("one","paused")],nextCursor:null});
    await act(async()=>vi.advanceTimersByTimeAsync(1000));
    expect(state.job?.phase).toBe("paused");
    await act(async()=>{accepted.resolve(true);await pending;});
    expect(state.requestedAction).toBeNull();
    expect(state.busy).toBe(false);
  });
  it("requires a fresh confirmation phrase after a started transfer pauses", async () => {
    api.list.mockResolvedValue({jobs:[job("one","awaitingReview")],nextCursor:null});
    api.start.mockResolvedValue(job("one","copying"));
    await act(async()=>root.render(<ResumableTransferDialog open projectId="p" request={request} onClose={vi.fn()} onBack={vi.fn()} />));
    await input("MIGRATE ABC123");
    await act(async()=>button("Start full transfer").click());
    await act(async()=>button("Pause after batch").click());
    api.list.mockResolvedValue({jobs:[job("one","paused")],nextCursor:null});
    await act(async()=>vi.advanceTimersByTimeAsync(1000));
    expect(document.querySelector<HTMLInputElement>("#large-transfer-confirmation")?.value).toBe("");
    expect(button("Resume full transfer").disabled).toBe(true);
    await input("MIGRATE ABC123");
    expect(button("Resume full transfer").disabled).toBe(false);
  });
  it("keeps cancellation pending for paused jobs until cleanup finishes or needs review", async () => {
    await act(async()=>root.render(<Harness />));
    await act(async()=>state.requestAction("cancel"));
    expect(state.requestedAction).toBe("cancel");
    await act(async()=>vi.advanceTimersByTimeAsync(1000));
    expect(state.requestedAction).toBe("cancel");
    api.list.mockResolvedValue({jobs:[{...job(),issue:"cancellation_requires_review"}],nextCursor:null});
    await act(async()=>vi.advanceTimersByTimeAsync(1000));
    expect(state.requestedAction).toBeNull();
    expect(state.job?.issue).toBe("cancellation_requires_review");
  });
  it("does not reuse a confirmation after a lost start acknowledgement", async () => {
    api.list.mockResolvedValue({jobs:[job("one","awaitingReview")],nextCursor:null});
    api.start.mockRejectedValue(new Error("start acknowledgement lost"));
    await act(async()=>root.render(<ResumableTransferDialog open projectId="p" request={request} onClose={vi.fn()} onBack={vi.fn()} />));
    await input("MIGRATE ABC123");
    await act(async()=>button("Start full transfer").click());
    expect(api.start).toHaveBeenCalledWith("p","one","MIGRATE ABC123");
    api.list.mockResolvedValue({jobs:[job("one","paused")],nextCursor:null});
    await act(async()=>vi.advanceTimersByTimeAsync(1000));
    expect(document.querySelector<HTMLInputElement>("#large-transfer-confirmation")?.value).toBe("");
    expect(button("Resume full transfer").disabled).toBe(true);
  });
});
