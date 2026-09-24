import { useCallback, useRef, type MutableRefObject } from "react";
import type { EditorClip, ExportResult } from "../types";
import { downloadBlob, uid } from "../utils";
import {
  duplicateAfterSelected,
  pictureClip,
  playheadForTrim,
  removeSelectedClip,
  reorderMagneticClips,
  seekAfterRemove,
  splitMagneticAtPlayhead,
} from "./editorOps";
import { exportAudioTimeline } from "./exportAudio";
import type { EditorSnapshot } from "./history";
import { clipStartMs, locateClip, totalDuration } from "./timelineMath";

type AudioSource = { file: Blob };

type AudioEdits = {
  clips: EditorClip[];
  clipsRef: MutableRefObject<EditorClip[]>;
  setClips: (update: EditorClip[] | ((current: EditorClip[]) => EditorClip[])) => EditorClip[];
  patchClipList: (id: string, patch: Partial<EditorClip>) => EditorClip[];
  selectedIdRef: MutableRefObject<string | null>;
  setSelectedId: (id: string | null) => void;
  playheadRef: MutableRefObject<number>;
  setPlayhead: (ms: number) => number;
  playingRef: MutableRefObject<boolean>;
  setPlaying: (update: boolean | ((current: boolean) => boolean)) => void;
  clipIndexRef: MutableRefObject<number>;
  skipClipSyncRef: MutableRefObject<boolean>;
  sourceMap: Record<string, AudioSource>;
  captureState: () => EditorSnapshot;
  commitCoalesced: (before: MutableRefObject<EditorSnapshot | null>) => void;
  recordHistory: () => void;
  applyLiveGain: (clip: EditorClip | null, localMs: number) => void;
  showClip: (index: number, offsetMs: number, autoplay: boolean) => Promise<void>;
  syncToPlayhead: (ms: number, autoplay: boolean) => Promise<void>;
  seek: (ms: number) => number;
  queueScrub: (ms: number) => void;
  setBusy: (busy: boolean) => void;
  setProgress: (progress: number | null) => void;
  setError: (error: string | null) => void;
  setLastExport: (result: ExportResult | null) => void;
  lastExport: ExportResult | null;
  report: (err: unknown) => void;
  onExport?: (result: ExportResult) => void;
};

export function useAudioEdits({
  clips,
  clipsRef,
  setClips,
  patchClipList,
  selectedIdRef,
  setSelectedId,
  playheadRef,
  setPlayhead,
  playingRef,
  setPlaying,
  clipIndexRef,
  skipClipSyncRef,
  sourceMap,
  captureState,
  commitCoalesced,
  recordHistory,
  applyLiveGain,
  showClip,
  syncToPlayhead,
  seek,
  queueScrub,
  setBusy,
  setProgress,
  setError,
  setLastExport,
  lastExport,
  report,
  onExport,
}: AudioEdits) {
  const trimBeforeRef = useRef<EditorSnapshot | null>(null);

  const appendClip = useCallback(
    (sourceId: string, durationMs: number) => {
      recordHistory();
      const clip = pictureClip(sourceId, durationMs, uid("clip"));
      const start = totalDuration(clipsRef.current);
      const index = clipsRef.current.length;
      setClips((current) => [...current, clip]);
      setSelectedId(clip.id);
      setPlayhead(start);
      clipIndexRef.current = index;
    },
    [clipIndexRef, clipsRef, recordHistory, setClips, setPlayhead, setSelectedId],
  );

  const patchClip = useCallback(
    (id: string, patch: Partial<EditorClip>) => {
      const next = patchClipList(id, patch);
      const hit = locateClip(next, playheadRef.current);
      if (hit) applyLiveGain(hit.clip, hit.offsetMs);
    },
    [applyLiveGain, patchClipList, playheadRef],
  );

  const handleTrim = useCallback(
    (id: string, inMs: number, outMs: number, edge: "in" | "out") => {
      if (!trimBeforeRef.current) trimBeforeRef.current = captureState();
      skipClipSyncRef.current = true;
      patchClip(id, { inMs, outMs });
      const next = clipsRef.current;
      const index = next.findIndex((clip) => clip.id === id);
      if (index < 0) return;
      const start = clipStartMs(next, index);
      const duration = Math.max(0, outMs - inMs);
      const { playhead, local } = playheadForTrim(start, duration, edge);
      setPlayhead(playhead);
      clipIndexRef.current = index;
      void showClip(index, local, false);
    },
    [captureState, clipIndexRef, clipsRef, patchClip, setPlayhead, showClip, skipClipSyncRef],
  );

  const handleTrimEnd = useCallback(() => {
    commitCoalesced(trimBeforeRef);
    skipClipSyncRef.current = false;
    if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
  }, [commitCoalesced, playheadRef, playingRef, skipClipSyncRef, syncToPlayhead]);

  const handleScrub = useCallback(
    (ms: number) => {
      playingRef.current = false;
      setPlaying(false);
      const next = setPlayhead(ms);
      const hit = locateClip(clipsRef.current, next);
      if (hit) {
        clipIndexRef.current = hit.index;
        setSelectedId(hit.clip.id);
        applyLiveGain(hit.clip, hit.offsetMs);
      }
      queueScrub(next);
    },
    [applyLiveGain, clipIndexRef, clipsRef, playingRef, queueScrub, setPlayhead, setPlaying, setSelectedId],
  );

  const handleReorder = useCallback(
    (from: number, to: number) => {
      const next = reorderMagneticClips(clipsRef.current, from, to);
      if (!next) return;
      recordHistory();
      setClips(next);
    },
    [clipsRef, recordHistory, setClips],
  );

  const handleSeek = useCallback(
    (ms: number) => {
      playingRef.current = false;
      setPlaying(false);
      const next = seek(ms);
      const hit = locateClip(clipsRef.current, next);
      if (hit) setSelectedId(hit.clip.id);
    },
    [clipsRef, seek, setPlaying, setSelectedId],
  );

  const split = useCallback(() => {
    const result = splitMagneticAtPlayhead(clipsRef.current, playheadRef.current, () => uid("clip"));
    if (!result) return;
    recordHistory();
    setClips(result.clips);
    setSelectedId(result.right.id);
    clipIndexRef.current = result.index + 1;
  }, [clipIndexRef, clipsRef, playheadRef, recordHistory, setClips, setSelectedId]);

  const duplicateSelected = useCallback(() => {
    const result = duplicateAfterSelected(clipsRef.current, selectedIdRef.current, uid("clip"));
    if (!result) return;
    recordHistory();
    setClips(result.clips);
    setSelectedId(result.copy.id);
    clipIndexRef.current = result.index + 1;
  }, [clipIndexRef, clipsRef, recordHistory, selectedIdRef, setClips, setSelectedId]);

  const deleteSelected = useCallback(() => {
    const result = removeSelectedClip(clipsRef.current, selectedIdRef.current);
    if (!result) return;
    recordHistory();
    setClips(result.clips);
    setSelectedId(result.neighbor?.id ?? null);
    const nextTime = seekAfterRemove(result.clips, result.neighbor, result.index, playheadRef.current);
    if (nextTime != null) seek(nextTime);
  }, [clipsRef, playheadRef, recordHistory, seek, selectedIdRef, setClips, setSelectedId]);

  const exportAudio = useCallback(async () => {
    if (!clips.length) return null;
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const result = await exportAudioTimeline({
        clips: clips.map((clip) => ({
          ...clip,
          file: sourceMap[clip.sourceId]?.file ?? new Blob(),
        })),
        onProgress: setProgress,
      });
      setLastExport(result);
      onExport?.(result);
      return result;
    } catch (err) {
      report(err);
      return null;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [clips, onExport, report, setBusy, setError, setLastExport, setProgress, sourceMap]);

  const download = useCallback(
    (filename?: string) => {
      if (!lastExport) return;
      downloadBlob(lastExport.blob, filename ?? lastExport.filename);
    },
    [lastExport],
  );

  return {
    appendClip,
    patchClip,
    handleTrim,
    handleTrimEnd,
    handleScrub,
    handleReorder,
    handleSeek,
    split,
    duplicateSelected,
    deleteSelected,
    exportAudio,
    download,
  };
}
