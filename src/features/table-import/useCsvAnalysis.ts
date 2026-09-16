import { useEffect, useRef, useState } from "react";
import { createCsvAnalysisClient } from "./csvAnalysisClient";
import type { CsvAnalysis, CsvAnalysisOptions } from "./csvImportSession";

type Client = ReturnType<typeof createCsvAnalysisClient>;
type AnalysisState = { source: Uint8Array | null } & (
  | { phase: "idle" | "analyzing"; key: string }
  | { phase: "error"; key: string; error: string }
  | { phase: "ready"; key: string; revision: number; value: CsvAnalysis });

/** Scope results to both source bytes and review options; stale reviews cannot submit. */
export function useCsvAnalysis(bytes: Uint8Array | null, options: CsvAnalysisOptions) {
  const clientRef = useRef<Client | null>(null);
  const sourceRef = useRef<Uint8Array | null>(null);
  const key = JSON.stringify(options);
  const latestRef = useRef({ bytes, key });
  latestRef.current = { bytes, key };
  const [state, setState] = useState<AnalysisState>({ source: null, phase: "idle", key: "" });
  const lastReadyRef = useRef<{ bytes: Uint8Array; value: CsvAnalysis } | null>(null);
  const sourceErrorRef = useRef<{ bytes: Uint8Array; error: string } | null>(null);

  useEffect(() => {
    if (!bytes) {
      lastReadyRef.current = null;
      sourceErrorRef.current = null;
      setState({ source: null, phase: "idle", key });
      return;
    }
    sourceRef.current = bytes;
    let client: Client;
    try {
      client = createCsvAnalysisClient(bytes);
      clientRef.current = client;
      sourceErrorRef.current = null;
    } catch (error) {
      sourceErrorRef.current = { bytes, error: String(error) };
      setState({ source: bytes, phase: "error", key, error: String(error) });
      return () => { sourceRef.current = null; };
    }
    return () => {
      client.dispose();
      clientRef.current = null;
      sourceRef.current = null;
    };
  }, [bytes]);

  useEffect(() => {
    const client = clientRef.current;
    if (!bytes || !client) return;
    let cancelled = false;
    setState({ source: bytes, phase: "analyzing", key });
    const timer = setTimeout(() => {
      void client.analyze(JSON.parse(key) as CsvAnalysisOptions).then(
        ({ revision, value }) => {
          if (!cancelled) {
            lastReadyRef.current = { bytes, value };
            setState({ source: bytes, phase: "ready", key, revision, value });
          }
        },
        (error) => {
          if (!cancelled) setState({ source: bytes, phase: "error", key, error: String(error) });
        },
      );
    }, 60);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [bytes, key]);

  const current = state.source === bytes && sourceRef.current === bytes && state.key === key;
  const sourceError = sourceErrorRef.current?.bytes === bytes ? sourceErrorRef.current.error : null;
  return {
    analysis: current && state.phase === "ready" ? state.value
      : lastReadyRef.current?.bytes === bytes ? lastReadyRef.current.value : null,
    isAnalyzing: Boolean(bytes) && !sourceError && (!current || state.phase === "analyzing"),
    error: sourceError || (current && state.phase === "error" ? state.error : null),
    async rows() {
      const client = clientRef.current;
      if (!current || state.phase !== "ready" || !client) throw new Error("Wait for CSV validation.");
      const rows = await client.rows(state.revision);
      if (client !== clientRef.current || bytes !== latestRef.current.bytes || key !== latestRef.current.key) {
        throw new Error("CSV review changed before submission.");
      }
      return rows;
    },
  };
}
