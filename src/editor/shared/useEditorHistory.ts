import { useCallback, useRef, useState, type MutableRefObject } from "react";
import type { EditorClip } from "../../types";
import { createHistory, sameClips, type EditorSnapshot } from "./history";

export function useEditorHistory(
  captureState: () => EditorSnapshot,
  applySnapshot: (snapshot: EditorSnapshot) => void,
  clipsRef: MutableRefObject<EditorClip[]>,
) {
  const historyRef = useRef(createHistory());
  const applyingHistoryRef = useRef(false);
  const applyRef = useRef(applySnapshot);
  const captureRef = useRef(captureState);
  applyRef.current = applySnapshot;
  captureRef.current = captureState;
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncHistoryButtons = useCallback(() => {
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, []);

  const recordHistory = useCallback(() => {
    if (applyingHistoryRef.current) return;
    historyRef.current.push(captureRef.current());
    syncHistoryButtons();
  }, [syncHistoryButtons]);

  const commitCoalesced = useCallback(
    (beforeRef: MutableRefObject<EditorSnapshot | null>) => {
      const before = beforeRef.current;
      beforeRef.current = null;
      if (before && !sameClips(before.clips, clipsRef.current)) {
        historyRef.current.push(before);
        syncHistoryButtons();
      }
    },
    [clipsRef, syncHistoryButtons],
  );

  const undo = useCallback(() => {
    const previous = historyRef.current.undo(captureRef.current());
    if (!previous) return;
    applyingHistoryRef.current = true;
    applyRef.current(previous);
    applyingHistoryRef.current = false;
    syncHistoryButtons();
  }, [syncHistoryButtons]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo(captureRef.current());
    if (!next) return;
    applyingHistoryRef.current = true;
    applyRef.current(next);
    applyingHistoryRef.current = false;
    syncHistoryButtons();
  }, [syncHistoryButtons]);

  return { applyingHistoryRef, canUndo, canRedo, recordHistory, commitCoalesced, undo, redo };
}
