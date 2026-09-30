import { useCallback, useRef, useState } from "react";
import type { EditorClip } from "../../types";
import { cloneSnapshot, type EditorSnapshot } from "./history";
import { clamp } from "../timeline/timelineMath";
import { useEditorClips } from "./useEditorClips";
import { useEditorHistory } from "./useEditorHistory";

export function useEditorSession(options: {
  onChange?: (clips: EditorClip[]) => void;
  timelineEndMs: (clips: EditorClip[]) => number;
  onApplySnapshot?: (clips: EditorClip[]) => void;
}) {
  const endMsRef = useRef(options.timelineEndMs);
  const onApplyRef = useRef(options.onApplySnapshot);
  endMsRef.current = options.timelineEndMs;
  onApplyRef.current = options.onApplySnapshot;

  const { clips, clipsRef, setClips, patchClip } = useEditorClips(options.onChange);

  const [selectedId, setSelectedIdState] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const setSelectedId = useCallback((id: string | null) => {
    selectedIdRef.current = id;
    setSelectedIdState(id);
  }, []);

  const [playheadMs, setPlayheadMs] = useState(0);
  const playheadRef = useRef(0);
  const setPlayhead = useCallback(
    (ms: number) => {
      const next = clamp(ms, 0, Math.max(0, endMsRef.current(clipsRef.current)));
      playheadRef.current = next;
      setPlayheadMs(next);
      return next;
    },
    [clipsRef],
  );

  const [playing, setPlayingState] = useState(false);
  const playingRef = useRef(false);
  const setPlaying = useCallback((update: boolean | ((current: boolean) => boolean)) => {
    const next = typeof update === "function" ? update(playingRef.current) : update;
    playingRef.current = next;
    setPlayingState(next);
  }, []);

  const clipIndexRef = useRef(0);
  const loadedSourceIdRef = useRef<string | null>(null);
  const syncGenRef = useRef(0);
  const seekingRef = useRef(false);
  const skipClipSyncRef = useRef(false);

  const captureState = useCallback(
    (): EditorSnapshot =>
      cloneSnapshot({
        clips: clipsRef.current,
        selectedId: selectedIdRef.current,
        playheadMs: playheadRef.current,
      }),
    [clipsRef],
  );

  const applySnapshot = useCallback(
    (snapshot: EditorSnapshot) => {
      const clipsNext = snapshot.clips.map((clip) => ({ ...clip }));
      setClips(clipsNext);
      setSelectedId(snapshot.selectedId);
      setPlayhead(snapshot.playheadMs);
      onApplyRef.current?.(clipsNext);
    },
    [setClips, setPlayhead, setSelectedId],
  );

  const history = useEditorHistory(captureState, applySnapshot, clipsRef);

  return {
    clips,
    clipsRef,
    setClips,
    patchClip,
    selectedId,
    selectedIdRef,
    setSelectedId,
    playheadMs,
    playheadRef,
    setPlayhead,
    playing,
    playingRef,
    setPlaying,
    clipIndexRef,
    loadedSourceIdRef,
    syncGenRef,
    seekingRef,
    skipClipSyncRef,
    captureState,
    applySnapshot,
    ...history,
  };
}
