import { useCallback, useRef, type MutableRefObject } from "react";
import type { EditorClip, ExportResult } from "../../types";
import { downloadBlob, uid } from "../../utils";
import { withClampedAudio } from "../shared/audioGain";
import {
  clipsForVideoExport,
  duplicateAfterSelected,
  extraAudioClip,
  pictureClip,
  playheadForTrim,
  removeSelectedClip,
  reorderVideoTrack,
  seekAfterRemove,
  splitClipsAtPlayhead,
  unlinkPictureAudio,
} from "../shared/editorOps";
import { exportTimeline } from "./exportTimeline";
import type { EditorSnapshot } from "../shared/history";
import {
  clipStartMs,
  isAudioClip,
  isPastPicture,
  isVideoClip,
  locateClip,
  totalDuration,
  videoTrackClips,
} from "../timeline/timelineMath";

type VideoSource = { file: Blob; url: string; width: number; height: number; hasAudio: boolean };

type VideoEdits = {
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
  sourcesRef: MutableRefObject<Record<string, VideoSource>>;
  sourceMap: Record<string, VideoSource>;
  captureState: () => EditorSnapshot;
  commitCoalesced: (before: MutableRefObject<EditorSnapshot | null>) => void;
  recordHistory: () => void;
  captureThumb: (clip: EditorClip, file?: Blob) => Promise<void>;
  transferThumb: (fromId: string | undefined, toId: string | undefined) => void;
  copyThumb: (fromId: string, toId: string) => void;
  forgetThumb: (id: string) => void;
  applyLiveGain: (clip: EditorClip | null, localMs: number) => void;
  syncExtraAudio: (ms: number, autoplay: boolean) => void;
  showClip: (index: number, offsetMs: number, autoplay: boolean) => Promise<void>;
  syncToPlayhead: (ms: number, autoplay: boolean) => Promise<void>;
  seek: (ms: number) => number;
  queueScrub: (ms: number) => void;
  connectGraph: () => void;
  setBusy: (busy: boolean) => void;
  setProgress: (progress: number | null) => void;
  setError: (error: string | null) => void;
  setLastExport: (result: ExportResult | null) => void;
  lastExport: ExportResult | null;
  report: (err: unknown) => void;
  onExport?: (result: ExportResult) => void;
};

export function useVideoEdits({
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
  sourcesRef,
  sourceMap,
  captureState,
  commitCoalesced,
  recordHistory,
  captureThumb,
  transferThumb,
  copyThumb,
  forgetThumb,
  applyLiveGain,
  syncExtraAudio,
  showClip,
  syncToPlayhead,
  seek,
  queueScrub,
  connectGraph,
  setBusy,
  setProgress,
  setError,
  setLastExport,
  lastExport,
  report,
  onExport,
}: VideoEdits) {
  const trimBeforeRef = useRef<EditorSnapshot | null>(null);
  const moveBeforeRef = useRef<EditorSnapshot | null>(null);

  const appendClip = useCallback(
    (sourceId: string, durationMs: number, file: Blob) => {
      recordHistory();
      const clip = pictureClip(sourceId, durationMs, uid("clip"));
      const start = totalDuration(clipsRef.current);
      const index = clipsRef.current.length;
      setClips((current) => [...current, clip]);
      setSelectedId(clip.id);
      setPlayhead(start);
      clipIndexRef.current = index;
      void captureThumb(clip, file);
    },
    [captureThumb, clipIndexRef, clipsRef, recordHistory, setClips, setPlayhead, setSelectedId],
  );

  const appendAudioClip = useCallback(
    (sourceId: string, durationMs: number) => {
      recordHistory();
      const clip = extraAudioClip(sourceId, durationMs, playheadRef.current, uid("clip"));
      setClips((current) => [...current, clip]);
      setSelectedId(clip.id);
    },
    [clipsRef, playheadRef, recordHistory, setClips, setSelectedId],
  );

  const handleTrim = useCallback(
    (id: string, inMs: number, outMs: number, edge: "in" | "out") => {
      if (!trimBeforeRef.current) trimBeforeRef.current = captureState();
      skipClipSyncRef.current = true;
      const next = setClips(
        clipsRef.current.map((clip) => (clip.id === id ? withClampedAudio({ ...clip, inMs, outMs }) : clip)),
      );
      const index = next.findIndex((clip) => clip.id === id);
      if (index < 0) return;
      const clip = next[index];
      const start = clipStartMs(next, index);
      const duration = Math.max(0, outMs - inMs);
      const { playhead, local } = playheadForTrim(start, duration, edge);
      setPlayhead(playhead);
      if (!clip || isAudioClip(clip)) {
        syncExtraAudio(playhead, false);
        return;
      }
      clipIndexRef.current = index;
      void showClip(index, local, false);
    },
    [captureState, clipIndexRef, clipsRef, setClips, setPlayhead, showClip, skipClipSyncRef, syncExtraAudio],
  );

  const handleTrimEnd = useCallback(() => {
    commitCoalesced(trimBeforeRef);
    skipClipSyncRef.current = false;
    const hit = locateClip(clipsRef.current, playheadRef.current);
    if (hit && isVideoClip(hit.clip)) void captureThumb(hit.clip);
    if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
  }, [captureThumb, clipsRef, commitCoalesced, playheadRef, playingRef, skipClipSyncRef, syncToPlayhead]);

  const patchClip = useCallback(
    (id: string, patch: Partial<EditorClip>) => {
      const next = patchClipList(id, patch);
      const hit = locateClip(next, playheadRef.current);
      if (hit) applyLiveGain(hit.clip, hit.offsetMs);
      syncExtraAudio(playheadRef.current, playingRef.current);
    },
    [applyLiveGain, patchClipList, playheadRef, playingRef, syncExtraAudio],
  );

  const unlinkSelected = useCallback(() => {
    const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!clip) return;
    const result = unlinkPictureAudio(
      clipsRef.current,
      clip.id,
      sourcesRef.current[clip.sourceId]?.hasAudio,
      () => uid("clip"),
    );
    if (!result) return;
    recordHistory();
    setClips(result.clips);
    setSelectedId(result.audioId);
    connectGraph();
    applyLiveGain({ ...result.picture, muted: true }, 0);
    syncExtraAudio(playheadRef.current, playingRef.current);
  }, [
    applyLiveGain,
    clipsRef,
    connectGraph,
    playheadRef,
    playingRef,
    recordHistory,
    selectedIdRef,
    setClips,
    setSelectedId,
    sourcesRef,
    syncExtraAudio,
  ]);

  const handleScrub = useCallback(
    (ms: number) => {
      playingRef.current = false;
      setPlaying(false);
      const next = setPlayhead(ms);
      const pastPicture = isPastPicture(clipsRef.current, next);
      const hit = locateClip(clipsRef.current, next);
      if (hit && !pastPicture) {
        clipIndexRef.current = hit.index;
        setSelectedId(hit.clip.id);
        applyLiveGain(hit.clip, hit.offsetMs);
      } else if (pastPicture) {
        applyLiveGain(null, 0);
      }
      queueScrub(next);
    },
    [applyLiveGain, clipIndexRef, clipsRef, playingRef, queueScrub, setPlayhead, setPlaying, setSelectedId],
  );

  const handleMoveAudio = useCallback(
    (id: string, startMs: number) => {
      if (!moveBeforeRef.current) moveBeforeRef.current = captureState();
      patchClip(id, { startMs: Math.max(0, startMs) });
    },
    [captureState, patchClip],
  );

  const handleMoveAudioEnd = useCallback(() => {
    commitCoalesced(moveBeforeRef);
  }, [commitCoalesced]);

  const handleReorder = useCallback(
    (from: number, to: number) => {
      const next = reorderVideoTrack(clipsRef.current, from, to);
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
      const selected = clipsRef.current.find((clip) => clip.id === selectedIdRef.current);
      if (selected && isAudioClip(selected)) return;
      if (isPastPicture(clipsRef.current, next)) return;
      const hit = locateClip(clipsRef.current, next);
      if (hit) setSelectedId(hit.clip.id);
    },
    [clipsRef, seek, selectedIdRef, setPlaying, setSelectedId],
  );

  const split = useCallback(
    (allTracks = false) => {
      const result = splitClipsAtPlayhead(
        clipsRef.current,
        playheadRef.current,
        selectedIdRef.current,
        allTracks,
        () => uid("clip"),
      );
      if (!result) return;
      recordHistory();
      setClips(result.clips);
      if (result.nextSelectedId) setSelectedId(result.nextSelectedId);
      if (result.videoRight) {
        clipIndexRef.current = result.clips.findIndex((clip) => clip.id === result.videoRight?.id);
        transferThumb(result.videoOldId, result.videoLeft?.id);
        void captureThumb(result.videoRight);
      }
    },
    [captureThumb, clipIndexRef, clipsRef, playheadRef, recordHistory, selectedIdRef, setClips, setSelectedId, transferThumb],
  );

  const duplicateSelected = useCallback(() => {
    const selected = clipsRef.current.find((clip) => clip.id === selectedIdRef.current);
    const result = duplicateAfterSelected(clipsRef.current, selectedIdRef.current, uid("clip"));
    if (!result) return;
    recordHistory();
    setClips(result.clips);
    setSelectedId(result.copy.id);
    if (isVideoClip(result.copy)) {
      clipIndexRef.current = result.clips.findIndex((item) => item.id === result.copy.id);
      if (selected) copyThumb(selected.id, result.copy.id);
      void captureThumb(result.copy);
    }
  }, [captureThumb, clipIndexRef, clipsRef, copyThumb, recordHistory, selectedIdRef, setClips, setSelectedId]);

  const deleteSelected = useCallback(() => {
    const id = selectedIdRef.current;
    const result = removeSelectedClip(clipsRef.current, id);
    if (!result || !id) return;
    recordHistory();
    setClips(result.clips);
    setSelectedId(result.neighbor?.id ?? null);
    forgetThumb(id);
    const nextTime = seekAfterRemove(result.clips, result.neighbor, result.index, playheadRef.current);
    if (nextTime != null) seek(nextTime);
  }, [clipsRef, forgetThumb, playheadRef, recordHistory, seek, selectedIdRef, setClips, setSelectedId]);

  const exportVideo = useCallback(async () => {
    if (!videoTrackClips(clips).length) return null;
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const payload = clipsForVideoExport(clips, sourceMap);
      const result = await exportTimeline({ ...payload, onProgress: setProgress });
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
    appendAudioClip,
    handleTrim,
    handleTrimEnd,
    patchClip,
    unlinkSelected,
    handleScrub,
    handleMoveAudio,
    handleMoveAudioEnd,
    handleReorder,
    handleSeek,
    split,
    duplicateSelected,
    deleteSelected,
    exportVideo,
    download,
  };
}
