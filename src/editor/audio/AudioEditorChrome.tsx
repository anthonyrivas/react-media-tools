import type { CSSProperties, DragEvent, ReactNode, RefObject } from "react";
import type { EditorClip } from "../../types";
import { StageWaveform } from "./StageWaveform";
import type { WaveformPeaks } from "../shared/waveform";
import {
  EditorError,
  EditorExportBar,
  EditorFileInput,
  EditorMixerBar,
  EditorPreviewFrame,
  EditorShell,
  EditorToolbar,
  EditorTools,
} from "../shared/EditorChrome";
import { Timeline, type TimelineHandle, type TimelineSource } from "../timeline/Timeline";

export function AudioEditorLayout({
  rootRef,
  className,
  style,
  busy,
  drop,
  fileRef,
  showOpenFile,
  showDownload,
  exportLabel,
  downloadLabel,
  clips,
  selected,
  gainPercent,
  gainText,
  canUndo,
  canRedo,
  progress,
  lastExport,
  playing,
  emptyBody,
  emptyHint,
  playheadMs,
  totalMs,
  audioRef,
  playheadClip,
  playheadPeaks,
  waveformLocalMs,
  playheadGain,
  sourceMap,
  selectedId,
  timelineRef,
  error,
  onSplit,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  onOpen,
  onFiles,
  onExport,
  onDownload,
  onMute,
  onGain,
  onGainCommit,
  onNormalize,
  onTogglePlay,
  onSelect,
  onSeek,
  onScrub,
  onTrim,
  onTrimEnd,
  onFade,
  onFadeEnd,
  onReorder,
}: {
  rootRef: RefObject<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  busy: boolean;
  drop: {
    fileHover: boolean;
    onDragEnter: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    onDrop: (event: DragEvent) => void;
  };
  fileRef: RefObject<HTMLInputElement>;
  showOpenFile: boolean;
  showDownload: boolean;
  exportLabel: string;
  downloadLabel: string;
  clips: EditorClip[];
  selected: EditorClip | null;
  gainPercent: number;
  gainText: string;
  canUndo: boolean;
  canRedo: boolean;
  progress: number | null;
  lastExport: boolean;
  playing: boolean;
  emptyBody: string;
  emptyHint: string;
  playheadMs: number;
  totalMs: number;
  audioRef: RefObject<HTMLAudioElement>;
  playheadClip: EditorClip | null;
  playheadPeaks?: WaveformPeaks;
  waveformLocalMs: number;
  playheadGain: number;
  sourceMap: Record<string, TimelineSource>;
  selectedId: string | null;
  timelineRef: RefObject<TimelineHandle>;
  error: string | null;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpen: () => void;
  onFiles: (files: File[]) => void;
  onExport: () => void;
  onDownload: () => void;
  onMute: () => void;
  onGain: (percent: number) => void;
  onGainCommit: () => void;
  onNormalize: () => void;
  onTogglePlay: () => void;
  onSelect: (id: string) => void;
  onSeek: (ms: number) => void;
  onScrub: (ms: number) => void;
  onTrim: (id: string, inMs: number, outMs: number, edge: "in" | "out") => void;
  onTrimEnd: () => void;
  onFade: (id: string, fadeInMs: number, fadeOutMs: number) => void;
  onFadeEnd: () => void;
  onReorder: (from: number, to: number) => void;
}): ReactNode {
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
      <EditorToolbar>
        <EditorTools
          hasClips={clips.length > 0}
          selected={Boolean(selected)}
          busy={busy}
          canUndo={canUndo}
          canRedo={canRedo}
          showOpenFile={showOpenFile}
          onSplit={onSplit}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onUndo={onUndo}
          onRedo={onRedo}
          onOpen={onOpen}
        />
        {showOpenFile && (
          <EditorFileInput fileRef={fileRef} accept="audio/*,.webm,.m4a,.mp3,.ogg,.wav,.aac,.flac" onFiles={onFiles} />
        )}
        <EditorExportBar
          exportLabel={exportLabel}
          progress={progress}
          disabled={!clips.length || busy}
          onExport={onExport}
          showDownload={showDownload}
          downloadLabel={downloadLabel}
          canDownload={lastExport && clips.length > 0}
          onDownload={onDownload}
        />
      </EditorToolbar>
      <EditorMixerBar
        muted={Boolean(selected?.muted)}
        muteDisabled={!selected}
        mutePressed={Boolean(selected?.muted)}
        onMute={onMute}
        gainPercent={gainPercent}
        gainDisabled={!selected}
        gainAriaText={`${gainPercent} percent`}
        gainText={gainText}
        onGain={onGain}
        onGainCommit={onGainCommit}
        normalizeDisabled={!selected || busy}
        onNormalize={onNormalize}
      />
      <EditorPreviewFrame
        playing={playing}
        hasClips={clips.length > 0}
        emptyTitle="No clips yet"
        emptyBody={emptyBody}
        playheadMs={playheadMs}
        totalMs={totalMs}
        onToggle={onTogglePlay}
      >
        <audio ref={audioRef} className="rmt-editor__audio" preload="auto" aria-hidden="true" />
        {playheadClip && playheadPeaks && (
          <StageWaveform
            peaks={playheadPeaks}
            inMs={playheadClip.inMs}
            outMs={playheadClip.outMs}
            localMs={waveformLocalMs}
            gain={playheadGain}
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
        emptyHint={emptyHint}
        onSelect={onSelect}
        onSeek={onSeek}
        onScrub={onScrub}
        onTrim={onTrim}
        onTrimEnd={onTrimEnd}
        onFade={onFade}
        onFadeEnd={onFadeEnd}
        onReorder={onReorder}
      />
      <EditorError error={error} />
    </EditorShell>
  );
}
