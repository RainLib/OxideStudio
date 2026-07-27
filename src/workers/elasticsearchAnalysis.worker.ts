import {
  parseElasticsearchConsoleRequests,
  validateElasticsearchConsole,
} from "@/lib/elasticsearchConsole";

export interface ElasticsearchAnalysisRequest {
  requestId: number;
  source: string;
}

export interface ElasticsearchAnalysisResponse {
  requestId: number;
  diagnostics: ReturnType<typeof validateElasticsearchConsole>;
  requestStartOffsets: number[];
}

globalThis.onmessage = (
  event: MessageEvent<ElasticsearchAnalysisRequest>,
) => {
  const { requestId, source } = event.data;
  const response: ElasticsearchAnalysisResponse = {
    requestId,
    diagnostics: validateElasticsearchConsole(source),
    requestStartOffsets: parseElasticsearchConsoleRequests(source).map(
      (request) => request.startOffset,
    ),
  };
  globalThis.postMessage(response);
};

export {};
