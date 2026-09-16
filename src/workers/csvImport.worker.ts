import { CsvImportSession, type CsvWorkerRequest, type CsvWorkerResponse } from "@/features/table-import/csvImportSession";

let session: CsvImportSession | undefined;
self.onmessage = (event: MessageEvent<CsvWorkerRequest>) => {
  const request = event.data;
  if (request.type === "init") {
    session = new CsvImportSession(request.bytes);
    return;
  }
  const response: CsvWorkerResponse = { id: request.id };
  try {
    if (!session) throw new Error("CSV source is not loaded.");
    response.value = request.type === "analyze"
      ? session.analyze(request.id, request.options) : session.rows(request.revision);
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  self.postMessage(response);
};
