// Executed inside an actual Tauri WebView. No mocked invoke or core calls.
(async () => {
  const fixture = globalThis.__OXIDE_IMPORT_FIXTURE__;
  const calls = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let n = 0; !globalThis.__TAURI_INTERNALS__?.invoke && n < 100; n++) await sleep(50);
  const invoke = (command, args = {}) => {
    calls.push(command);
    return globalThis.__TAURI_INTERNALS__.invoke(command, args);
  };
  const request = (command, value) => invoke(command, { request: value });
  const data = async promise => {
    const result = await promise;
    check(result.success === true, JSON.stringify(result.error));
    return result.data;
  };
  const rejected = async (promise, code) => {
    const result = await promise;
    check(result.success === false && result.error?.code === code, `expected ${code}: ${JSON.stringify(result)}`);
  };
  const identity = id => ({ projectId: "ipc-project", id });
  const target = published => invoke("acceptance_target", { published });
  let receipt;
  try {
    let preview, cancelledJobId;
    if (fixture.stage === "prepare") {
      const source = await data(invoke("preview_table_json_import", { filePath: fixture.source }));
      check(source.contentDigest.length === 64 && source.fileName.includes("雪"), "native source preview metadata");
      const options = { projectId: "ipc-project", importId: "ipc-import-prepare", connectionId: "ipc-target", driver: "sqlite", schema: "main", table: "target", database: "main", filePath: fixture.source, format: "json", mode: "append", firstRowHeader: true, expectedFileDigest: source.contentDigest };
      await rejected(request("prepare_table_import_job", { ...options, importId: "ipc-wrong-target", database: "different.sqlite" }), "TABLE_IMPORT_JOB_PREPARE_ERROR");
      await target(false);
      preview = await data(request("prepare_table_import_job", options));
      check(preview.job.phase === "awaitingReview" && preview.job.sourceRows === fixture.rows, "prepared row count/phase");
      check(preview.targetRowsBefore === 1 && preview.confirmationToken.startsWith("IMPORT "), "explicit review required");
      await target(false);
      const preparations = await data(request("list_table_import_preparations", { projectId: "ipc-project" }));
      check(preparations.preparations.length === 0, "ready handoff retires preparation");
      const cancelled = await data(request("prepare_table_import_job", { ...options, importId: "ipc-import-cancel" }));
      cancelledJobId = cancelled.job.id;
      await data(request("cancel_large_transfer", identity(cancelledJobId)));
      const cancelDeadline = Date.now() + 10000;
      while ((await data(request("get_large_transfer", identity(cancelledJobId)))).phase !== "cancelled") {
        check(Date.now() < cancelDeadline, "cancellation deadline");
        await sleep(25);
      }
      await target(false);
    } else {
      const saved = fixture.saved;
      const jobs = await data(request("list_table_import_jobs", { projectId: "ipc-project" }));
      check(jobs.jobs.length === 2 && jobs.jobs.some(job => job.id === saved.jobId), "saved job restored after process restart");
      check(jobs.jobs.some(job => job.id === saved.cancelledJobId && job.phase === "cancelled"), "cancellation survives restart");
      preview = await data(request("preview_large_transfer", identity(saved.jobId)));
      check(preview.confirmationToken === saved.confirmationToken && preview.job.phase === "awaitingReview", "review unchanged on reopen");
      const handoff = await data(request("resume_table_import_preparation", { projectId: "ipc-project", preparationId: saved.jobId }));
      check(handoff.job.id === saved.jobId && handoff.confirmationToken === saved.confirmationToken, "idempotent IPC preparation handoff");
    }
    const id = preview.job.id;
    const hidden = await data(request("list_table_import_jobs", { projectId: "other-project" }));
    check(hidden.jobs.length === 0, "project history isolation");
    await rejected(request("get_large_transfer", { projectId: "other-project", id }), "LARGE_TRANSFER_READ_ERROR");
    await rejected(request("start_large_transfer", { ...identity(id), confirmationToken: "incorrect review" }), "LARGE_TRANSFER_START_ERROR");
    await rejected(request("pause_large_transfer", identity(id)), "LARGE_TRANSFER_PAUSE_ERROR");
    await target(false);
    if (fixture.stage === "prepare") {
      receipt = { success: true, jobId: id, cancelledJobId, cancellationVerified: true, confirmationToken: preview.confirmationToken, sourceRows: preview.job.sourceRows, targetBefore: await target(false), reviewRejectionVerified: true, projectIsolationVerified: true };
    } else {
      await data(request("start_large_transfer", { ...identity(id), confirmationToken: preview.confirmationToken }));
      const deadline = Date.now() + 60000;
      let job;
      do {
        job = await data(request("get_large_transfer", identity(id)));
        check(!["failed", "cancelled"].includes(job.phase), `unexpected publication ${job.phase}: ${job.issue}`);
        if (job.phase === "completed") break;
        check(Date.now() < deadline, "publication deadline");
        await sleep(25);
      } while (true);
      check(job.rowsStaged === fixture.rows && job.sourceRows === fixture.rows, "all rows staged");
      const verified = await target(true);
      const duplicate = await data(request("start_large_transfer", { ...identity(id), confirmationToken: preview.confirmationToken }));
      check(duplicate.id === id && duplicate.phase === "completed", "completed start is idempotent");
      await target(true);
      receipt = { success: true, jobId: id, sourceRows: job.sourceRows, rowsStaged: job.rowsStaged, targetAfter: verified, restoredReviewVerified: true, offlineSourceVerified: true, duplicateStartIdempotent: true, reviewRejectionVerified: true, projectIsolationVerified: true };
    }
  } catch (error) {
    receipt = { success: false, error: String(error?.stack ?? error) };
  }
  receipt.commands = calls;
  await invoke("acceptance_finish", { report: receipt });
})();
