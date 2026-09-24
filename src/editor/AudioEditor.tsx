import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { EditorClip, EditorInput, ExportResult } from "../types";
import { droppedMediaFiles } from "./shared/editorDom";
import {
  EditorError,
  EditorExportBar,
  EditorFileInput,
  EditorMixerBar,
  EditorPreviewFrame,
  EditorShell,
  EditorTools,
} from "./shared/EditorChrome";
import { useAudioEdits } from "./audio/useAudioEdits";
import { useAudioPreview } from "./audio/useAudioPreview";
import { useEditorHotkeys } from "./shared/useEditorHotkeys";
import { createAudioSource, useEditorIngest, type LoadedAudioSource } from "./shared/useEditorIngest";
import { useEditorMixer } from "./shared/useEditorMixer";
import { useEditorSession } from "./shared/useEditorSession";
import { useEditorSources } from "./shared/useEditorSources";
import { useEditorStatus } from "./shared/useEditorStatus";
import { useFileDrop } from "./shared/useFileDrop";
import { Timeline, type TimelineHandle } from "./timeline/Timeline";
import { StageWaveform } from "./audio/StageWaveform";
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
    <EditorShell
      rootRef={rootRef}
      className={["rmt-editor--audio", className].filter(Boolean).join(" ")}
      style={style}
      label="Audio editor"
      busy={busy}
      fileHover={drop.fileHover}
      drop={drop}
    >
      <div className="rmt-editor__toolbar" role="toolbar" aria-label="Editor tools">
        <EditorTools
          hasClips={clips.length > 0}
          selected={Boolean(selected)}
          busy={busy}
          canUndo={canUndo}
          canRedo={canRedo}
          showOpenFile={showOpenFile}
          onSplit={edits.split}
          onDuplicate={edits.duplicateSelected}
          onDelete={edits.deleteSelected}
          onUndo={undo}
          onRedo={redo}
          onOpen={() => fileRef.current?.click()}
        />
        {showOpenFile && (
          <EditorFileInput
            fileRef={fileRef}
            accept="audio/*,.webm,.m4a,.mp3,.ogg,.wav,.aac,.flac"
            onFiles={(files) => files.forEach((file) => void addSource(file, file.name))}
          />
        )}
        <EditorExportBar
          exportLabel={exportLabel}
          progress={progress}
          disabled={!clips.length || busy}
          onExport={() => void edits.exportAudio()}
          showDownload={showDownload}
          downloadLabel={downloadLabel}
          canDownload={Boolean(lastExport && clips.length)}
          onDownload={() => edits.download()}
        />
      </div>
      <EditorMixerBar
        muted={Boolean(selected?.muted)}
        muteDisabled={!selected}
        mutePressed={Boolean(selected?.muted)}
        onMute={toggleMute}
        gainPercent={gainPercent}
        gainDisabled={!selected}
        gainAriaText={`${gainPercent} percent`}
        gainText={selected ? (selected.muted ? "Muted" : `${gainPercent}%`) : "—"}
        onGain={handleGainInput}
        onGainCommit={handleGainCommit}
        normalizeDisabled={!selected || busy}
        onNormalize={() => void normalizeSelected()}
      />
      <EditorPreviewFrame
        playing={playing}
        hasClips={clips.length > 0}
        emptyTitle="No clips yet"
        emptyBody={
          showOpenFile
            ? "Drop audio here, send a recording, or open a file."
            : "Drop audio here, or send a recording."
        }
        playheadMs={playheadMs}
        totalMs={totalMs}
        onToggle={togglePlay}
      >
        <audio ref={audioRef} className="rmt-editor__audio" preload="auto" aria-hidden="true" />
        {playheadClip && sourceMap[playheadClip.sourceId]?.peaks && (
          <StageWaveform
            peaks={sourceMap[playheadClip.sourceId]!.peaks!}
            inMs={playheadClip.inMs}
            outMs={playheadClip.outMs}
            localMs={hit && hit.clip.id === playheadClip.id ? hit.offsetMs : 0}
            gain={clipGain(playheadClip)}
          />
        )}
      </EditorPreviewFrame>
      <Timeline
        ref={timelineRef}
        clips={clips}
        sources={sourceMap}
        selectedId={selectedId}
        playheadMs={playheadMs}
        showFades
        emptyHint={
          showOpenFile
            ? "Drop audio, send a recording, or open a file."
            : "Drop audio, or send a recording."
        }
        onSelect={setSelectedId}
        onSeek={edits.handleSeek}
        onScrub={edits.handleScrub}
        onTrim={edits.handleTrim}
        onTrimEnd={edits.handleTrimEnd}
        onFade={handleFade}
        onFadeEnd={handleFadeEnd}
        onReorder={edits.handleReorder}
      />
      <EditorError error={error} />
    </EditorShell>
  );
});
