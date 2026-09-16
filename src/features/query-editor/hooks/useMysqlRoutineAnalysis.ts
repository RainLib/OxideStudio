import {
  analyzeMysqlRoutineSyntax,
  supportsMysqlRoutineSyntaxDiagnostics,
  type MysqlRoutineSyntaxAnalysis,
} from "@/features/query-editor/model/mysqlRoutineSyntaxDiagnostics";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useCallback, useRef } from "react";

interface MysqlRoutineAnalysisOptions {
  driver: DatabaseDriver;
}

export function useMysqlRoutineAnalysis({
  driver,
}: MysqlRoutineAnalysisOptions) {
  const mysqlRoutineAnalysisRef = useRef<{
    model: any;
    version: number;
    analysis: MysqlRoutineSyntaxAnalysis;
  } | null>(null);
  const mysqlRoutineAnalysisForModel = useCallback(
    (model: any) => {
      if (!supportsMysqlRoutineSyntaxDiagnostics(driver)) {
        mysqlRoutineAnalysisRef.current = null;
        return null;
      }
      const version = model.getVersionId();
      const cached = mysqlRoutineAnalysisRef.current;
      if (cached && cached.model === model && cached.version === version) {
        return cached.analysis;
      }
      const analysis = analyzeMysqlRoutineSyntax(model.getValue());
      mysqlRoutineAnalysisRef.current = { model, version, analysis };
      return analysis;
    },
    [driver],
  );

  return { mysqlRoutineAnalysisForModel };
}
