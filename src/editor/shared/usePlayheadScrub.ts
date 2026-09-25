import { useCallback, useEffect, useRef } from "react";

export function usePlayheadScrub(syncToPlayhead: (ms: number, autoplay: boolean) => void) {
  const scrubRaf = useRef(0);
  const pendingScrub = useRef<number | null>(null);
  const syncRef = useRef(syncToPlayhead);
  syncRef.current = syncToPlayhead;

  useEffect(
    () => () => {
      if (scrubRaf.current) cancelAnimationFrame(scrubRaf.current);
    },
    [],
  );

  return useCallback((ms: number) => {
    pendingScrub.current = ms;
    if (scrubRaf.current) return;
    scrubRaf.current = requestAnimationFrame(() => {
      scrubRaf.current = 0;
      const time = pendingScrub.current;
      if (time != null) void syncRef.current(time, false);
    });
  }, []);
}
