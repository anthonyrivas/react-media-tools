import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { EditorClip, EditorInput, ExportResult } from "../types";
import { droppedMediaFiles } from "./shared/editorDom";
import { useAudioEdits } from "./audio/useAudioEdits";
import { useAudioPreview } from "./audio/useAudioPreview";
import { useEditorHotkeys } from "./shared/useEditorHotkeys";
import { createAudioSource, useEditorIngest, type LoadedAudioSource } from "./shared/useEditorIngest";
import { useEditorMixer } from "./shared/useEditorMixer";
import { useEditorSession } from "./shared/useEditorSession";
import { useEditorSources } from "./shared/useEditorSources";
import { useEditorStatus } from "./shared/useEditorStatus";
import { useFileDrop } from "./shared/useFileDrop";
import { type TimelineHandle } from "./timeline/Timeline";
import { AudioEditorLayout } from "./audio/AudioEditorChrome";
import { audioEditorEmptyBody, audioEditorEmptyHint, audioMixerText } from "./audio/audioEditorView";
import { clipGain } from "./shared/audioGain";
import { locateClip, totalDuration } from "./timeline/timelineMath";

export type AudioEditorHandle = {
  addSource: (input: EditorInput | Blob, name?: string) => Promise<void>;
  split: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  normalizeSelected: () => Promise<void>;
  exportAudio: () => Promise<ExportResult | null>;
  download: (filename?: string) => void;
};

export type AudioEditorProps = {
  className?: string;
  style?: React.CSSProperties;
  sources?: EditorInput[];
  /** Shows an Open file control. Off by default; hosts can also call `addSource`. */
  showOpenFile?: boolean;
  /** Shows a Download control after export. Off by default; use `onExport` or `download()`. */
  showDownload?: boolean;
  /** Label for the encode button. Progress is appended as a percent. */
  exportLabel?: string;
  /** Label for the optional Download control. */
  downloadLabel?: string;
  onExport?: (result: ExportResult) => void;
  onChange?: (clips: EditorClip[]) => void;
  onError?: (error: Error) => void;
};

export const AudioEditor = forwardRef<AudioEditorHandle, AudioEditorProps>(function AudioEditor(
  {
    className,
    style,
    sources: incoming,
    showOpenFile = false,
    showDownload = false,
    exportLabel = "Export",
    downloadLabel = "Download",
    onExport,
    onChange,
    onError,
  },
  ref,
) {
  const { sourceMap, setSourceMap, sourcesRef, knownIds } = useEditorSources<LoadedAudioSource>();
  const {
    clips,
    clipsRef,
    setClips,
    patchClip: patchClipList,
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
    canUndo,
    canRedo,
    recordHistory,
    commitCoalesced,
    undo,
    redo,
  } = useEditorSession({
    onChange,
    timelineEndMs: totalDuration,
  });
  const { busy, setBusy, progress, setProgress, error, setError, lastExport, setLastExport, report } =
    useEditorStatus(onError);
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const totalMs = useMemo(() => totalDuration(clips), [clips]);
  const selected = clips.find((clip) => clip.id === selectedId) ?? null;
  const playheadClip = locateClip(clips, playheadMs)?.clip ?? selected;
  const {
    audioRef,
    applyLiveGain,
    showClip,
    syncToPlayhead,
    seek,
    queueScrub,
    togglePlay,
  } = useAudioPreview({
    clips,
    clipsRef,
    sourcesRef,
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
  });
  const edits = useAudioEdits({
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
  });
  const addSource = useEditorIngest({
    incoming,
    sourcesRef,
    knownIds,
    setSourceMap,
    setBusy,
    setError,
    report,
    createSource: createAudioSource,
    onSource: (source) => edits.appendClip(source.id, source.durationMs),
  });
  const { handleFade, handleFadeEnd, handleGainInput, handleGainCommit, toggleMute, normalizeSelected } =
    useEditorMixer({
      clipsRef,
      selectedIdRef,
      sourcesRef,
      captureState,
      commitCoalesced,
      recordHistory,
      patchClip: edits.patchClip,
      report,
      setBusy,
      setError,
    });
  const drop = useFileDrop((fileList) => {
    droppedMediaFiles(fileList, "audio").forEach((file) => void addSource(file, file.name).catch(() => undefined));
  });

  useImperativeHandle(
    ref,
    () => ({
      addSource,
      split: edits.split,
      duplicateSelected: edits.duplicateSelected,
      deleteSelected: edits.deleteSelected,
      undo,
      redo,
      normalizeSelected,
      exportAudio: edits.exportAudio,
      download: edits.download,
    }),
    [addSource, edits, undo, redo, normalizeSelected],
  );

  useEditorHotkeys({
    rootRef,
    clipsRef,
    selectedIdRef,
    playheadRef,
    timelineRef,
    timelineEndMs: () => totalDuration(clipsRef.current),
    undo,
    redo,
    duplicateSelected: edits.duplicateSelected,
    togglePlay,
    handleScrub: edits.handleScrub,
    setSelectedId,
    split: edits.split,
    toggleMute,
    deleteSelected: edits.deleteSelected,
  });

  const gainPercent = Math.round((selected?.volume ?? 1) * 100);
  const hit = locateClip(clips, playheadMs);

  return (
    <AudioEditorLayout
      rootRef={rootRef}
      className={className}
      style={style}
      busy={busy}
      drop={drop}
      fileRef={fileRef}
      showOpenFile={showOpenFile}
      showDownload={showDownload}
      exportLabel={exportLabel}
      downloadLabel={downloadLabel}
      clips={clips}
      selected={selected}
      gainPercent={gainPercent}
      gainText={audioMixerText(selected, gainPercent)}
      canUndo={canUndo}
      canRedo={canRedo}
      progress={progress}
      lastExport={Boolean(lastExport)}
      playing={playing}
      emptyBody={audioEditorEmptyBody(showOpenFile)}
      emptyHint={audioEditorEmptyHint(showOpenFile)}
      playheadMs={playheadMs}
      totalMs={totalMs}
      audioRef={audioRef}
      playheadClip={playheadClip}
      playheadPeaks={playheadClip ? sourceMap[playheadClip.sourceId]?.peaks : undefined}
      waveformLocalMs={hit && playheadClip && hit.clip.id === playheadClip.id ? hit.offsetMs : 0}
      playheadGain={playheadClip ? clipGain(playheadClip) : 0}
      sourceMap={sourceMap}
      selectedId={selectedId}
      timelineRef={timelineRef}
      error={error}
      onSplit={edits.split}
      onDuplicate={edits.duplicateSelected}
      onDelete={edits.deleteSelected}
      onUndo={undo}
      onRedo={redo}
      onOpen={() => fileRef.current?.click()}
      onFiles={(files) => files.forEach((file) => void addSource(file, file.name))}
      onExport={() => void edits.exportAudio()}
      onDownload={() => edits.download()}
      onMute={toggleMute}
      onGain={handleGainInput}
      onGainCommit={handleGainCommit}
      onNormalize={() => void normalizeSelected()}
      onTogglePlay={togglePlay}
      onSelect={setSelectedId}
      onSeek={edits.handleSeek}
      onScrub={edits.handleScrub}
      onTrim={edits.handleTrim}
      onTrimEnd={edits.handleTrimEnd}
      onFade={handleFade}
      onFadeEnd={handleFadeEnd}
      onReorder={edits.handleReorder}
    />
  );
});
