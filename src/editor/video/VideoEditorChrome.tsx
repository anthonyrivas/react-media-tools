import type { CSSProperties, DragEvent, MutableRefObject, ReactNode, RefObject } from "react";
import type { EditorClip } from "../../types";
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
import type { VideoMixerView } from "./videoEditorView";

export function VideoEditorLayout({
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
  pictureCount,
  selected,
  mixer,
  canUndo,
  canRedo,
  progress,
  lastExport,
  playing,
  blankPicture,
  emptyBody,
  emptyHint,
  playheadMs,
  totalMs,
  videoRef,
  extraAudio,
  extraAudioEls,
  sourceMap,
  clipThumbs,
  selectedId,
  timelineRef,
  error,
  onSplit,
  onSplitAll,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  onOpen,
  onFiles,
  onExport,
  onDownload,
  onMute,
  onUnlink,
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
  onMoveAudio,
  onMoveAudioEnd,
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
  pictureCount: number;
  selected: EditorClip | null;
  mixer: VideoMixerView;
  canUndo: boolean;
  canRedo: boolean;
  progress: number | null;
  lastExport: boolean;
  playing: boolean;
  blankPicture: boolean;
  emptyBody: string;
  emptyHint: string;
  playheadMs: number;
  totalMs: number;
  videoRef: RefObject<HTMLVideoElement>;
  extraAudio: EditorClip[];
  extraAudioEls: MutableRefObject<Map<string, HTMLAudioElement>>;
  sourceMap: Record<string, TimelineSource>;
  clipThumbs: Record<string, string>;
  selectedId: string | null;
  timelineRef: RefObject<TimelineHandle>;
  error: string | null;
  onSplit: () => void;
  onSplitAll: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpen: () => void;
  onFiles: (files: File[]) => void;
  onExport: () => void;
  onDownload: () => void;
  onMute: () => void;
  onUnlink: () => void;
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
  onMoveAudio: (id: string, startMs: number) => void;
  onMoveAudioEnd: () => void;
}): ReactNode {
  return (
    <EditorShell
      rootRef={rootRef}
      className={className}
      style={style}
      label="Video editor"
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
          onSplitAll={onSplitAll}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onUndo={onUndo}
          onRedo={onRedo}
          onOpen={onOpen}
        />
        {showOpenFile && (
          <EditorFileInput fileRef={fileRef} accept="video/*,audio/*,.webm,.m4a,.mp3,.ogg,.wav,.aac,.flac" onFiles={onFiles} />
        )}
        <EditorExportBar
          exportLabel={exportLabel}
          progress={progress}
          disabled={!pictureCount || busy}
          onExport={onExport}
          showDownload={showDownload}
          downloadLabel={downloadLabel}
          canDownload={lastExport && clips.length > 0}
          onDownload={onDownload}
        />
      </EditorToolbar>
      <EditorMixerBar
        muted={Boolean(selected?.muted) || mixer.audioMoved}
        muteDisabled={!mixer.mixerEnabled}
        mutePressed={mixer.mutePressed}
        onMute={onMute}
        unlinkDisabled={!mixer.canUnlink}
        onUnlink={onUnlink}
        gainPercent={mixer.mixerEnabled ? mixer.gainPercent : 100}
        gainDisabled={!mixer.mixerEnabled}
        gainAriaText={mixer.gainAriaText}
        gainText={mixer.gainText}
        onGain={onGain}
        onGainCommit={onGainCommit}
        normalizeDisabled={!mixer.mixerEnabled || busy}
        onNormalize={onNormalize}
      />
      <EditorPreviewFrame
        playing={playing}
        blank={blankPicture}
        hasClips={clips.length > 0}
        emptyTitle="No clips yet"
        emptyBody={emptyBody}
        playheadMs={playheadMs}
        totalMs={totalMs}
        onToggle={onTogglePlay}
      >
        <video ref={videoRef} className="rmt-editor__video" playsInline preload="auto" aria-hidden="true" />
        {extraAudio.map((clip) => (
          <audio
            key={clip.id}
            className="rmt-editor__audio"
            ref={(node) => {
              if (node) extraAudioEls.current.set(clip.id, node);
              else extraAudioEls.current.delete(clip.id);
            }}
            preload="auto"
            playsInline
          />
        ))}
      </EditorPreviewFrame>
      <Timeline
        ref={timelineRef}
        clips={clips}
        sources={sourceMap}
        thumbs={clipThumbs}
        selectedId={selectedId}
        playheadMs={playheadMs}
        onSelect={onSelect}
        onSeek={onSeek}
        onScrub={onScrub}
        onTrim={onTrim}
        onTrimEnd={onTrimEnd}
        onFade={onFade}
        onFadeEnd={onFadeEnd}
        onReorder={onReorder}
        onMoveAudio={onMoveAudio}
        onMoveAudioEnd={onMoveAudioEnd}
        showFades
        showAudioTrack
        emptyHint={emptyHint}
      />
      <EditorError error={error} />
    </EditorShell>
  );
}
