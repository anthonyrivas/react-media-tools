import { useCallback, useState } from "react";
import type { ExportResult } from "../../types";

export function useEditorStatus(onError?: (error: Error) => void) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);

  const report = useCallback(
    (err: unknown) => {
      const next = err instanceof Error ? err : new Error(String(err));
      setError(next.message);
      onError?.(next);
    },
    [onError],
  );

  return { busy, setBusy, progress, setProgress, error, setError, lastExport, setLastExport, report };
}
