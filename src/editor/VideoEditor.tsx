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
import { useClipThumbs } from "./video/useClipThumbs";
import { useEditorHotkeys } from "./shared/useEditorHotkeys";
import { createVideoSource, useEditorIngest, type LoadedVideoSource } from "./shared/useEditorIngest";
import { useEditorMixer } from "./shared/useEditorMixer";
import { useEditorSession } from "./shared/useEditorSession";
import { useEditorSources } from "./shared/useEditorSources";
import { useEditorStatus } from "./shared/useEditorStatus";
import { useFileDrop } from "./shared/useFileDrop";
import { useVideoEdits } from "./video/useVideoEdits";
import { useVideoPreview } from "./video/useVideoPreview";
import { Timeline, type TimelineHandle } from "./timeline/Timeline";
import {
  clipHasPlayableAudio,
  hasDetachedAudio,
  isVideoClip,
  timelineDuration,
  videoTrackClips,
} from "./timeline/timelineMath";

export type VideoEditorHandle = {
  addSource: (input: EditorInput | Blob, name?: string) => Promise<void>;
  split: (allTracks?: boolean) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  exportVideo: () => Promise<ExportResult | null>;
  download: (filename?: string) => void;
  normalizeSelected: () => Promise<void>;
  unlinkSelected: () => void;
};

export type VideoEditorProps = {
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

export const VideoEditor = forwardRef<VideoEditorHandle, VideoEditorProps>(
  function VideoEditor(
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
    const { sourceMap, setSourceMap, sourcesRef, knownIds } = useEditorSources<LoadedVideoSource>();
    const { clipThumbs, captureThumb, applySnapshot, transferThumb, copyThumb, forgetThumb } = useClipThumbs(sourcesRef);
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
      timelineEndMs: timelineDuration,
      onApplySnapshot: applySnapshot,
    });
    const { busy, setBusy, progress, setProgress, error, setError, lastExport, setLastExport, report } =
      useEditorStatus(onError);
    const fileRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<TimelineHandle>(null);
    const totalMs = useMemo(() => timelineDuration(clips), [clips]);
    const pictureClips = useMemo(() => videoTrackClips(clips), [clips]);
    const {
      videoRef,
      extraAudioEls,
      extraAudio,
      blankPicture,
      connectGraph,
      applyLiveGain,
      syncExtraAudio,
      showClip,
      syncToPlayhead,
      seek,
      queueScrub,
      togglePlay,
    } = useVideoPreview({
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
    const edits = useVideoEdits({
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
    });
    const addSource = useEditorIngest({
      incoming,
      sourcesRef,
      knownIds,
      setSourceMap,
      setBusy,
      setError,
      report,
      createSource: createVideoSource,
      onSource: (source) => {
        if (!source.width && !source.height) edits.appendAudioClip(source.id, source.durationMs);
        else edits.appendClip(source.id, source.durationMs, source.file);
      },
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
        canMix: (clip) =>
          clipHasPlayableAudio(clipsRef.current, clip, sourcesRef.current[clip.sourceId]?.hasAudio !== false),
      });
    const drop = useFileDrop((fileList) => {
      droppedMediaFiles(fileList, "video").forEach((file) => void addSource(file, file.name).catch(() => undefined));
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
        exportVideo: edits.exportVideo,
        download: edits.download,
        normalizeSelected,
        unlinkSelected: edits.unlinkSelected,
      }),
      [addSource, edits, undo, redo, normalizeSelected],
    );

    useEditorHotkeys({
      rootRef,
      clipsRef,
      selectedIdRef,
      playheadRef,
      timelineRef,
      timelineEndMs: () => timelineDuration(clipsRef.current),
      undo,
      redo,
      duplicateSelected: edits.duplicateSelected,
      togglePlay,
      handleScrub: edits.handleScrub,
      setSelectedId,
      split: edits.split,
      toggleMute,
      deleteSelected: edits.deleteSelected,
      unlinkSelected: edits.unlinkSelected,
    });

    const selected = clips.find((clip) => clip.id === selectedId) ?? null;
    const selectedSource = selected ? sourceMap[selected.sourceId] : undefined;
    const mixerEnabled =
      selected != null && clipHasPlayableAudio(clips, selected, selectedSource?.hasAudio !== false);
    const gainPercent = Math.round((selected?.volume ?? 1) * 100);
    const canUnlink = selected != null && mixerEnabled && isVideoClip(selected);
    const audioMoved = selected != null && isVideoClip(selected) && hasDetachedAudio(clips, selected.id);

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
        <div className="rmt-editor__toolbar" role="toolbar" aria-label="Editor tools">
          <EditorTools
            hasClips={clips.length > 0}
            selected={Boolean(selected)}
            busy={busy}
            canUndo={canUndo}
            canRedo={canRedo}
            showOpenFile={showOpenFile}
            onSplit={() => edits.split()}
            onSplitAll={() => edits.split(true)}
            onDuplicate={edits.duplicateSelected}
            onDelete={edits.deleteSelected}
            onUndo={undo}
            onRedo={redo}
            onOpen={() => fileRef.current?.click()}
          />
          {showOpenFile && (
            <EditorFileInput
              fileRef={fileRef}
              accept="video/*,audio/*,.webm,.m4a,.mp3,.ogg,.wav,.aac,.flac"
              onFiles={(files) => files.forEach((file) => void addSource(file, file.name))}
            />
          )}
          <EditorExportBar
            exportLabel={exportLabel}
            progress={progress}
            disabled={!pictureClips.length || busy}
            onExport={() => void edits.exportVideo()}
            showDownload={showDownload}
            downloadLabel={downloadLabel}
            canDownload={Boolean(lastExport && clips.length)}
            onDownload={() => edits.download()}
          />
        </div>
        <EditorMixerBar
          muted={Boolean(selected?.muted) || audioMoved}
          muteDisabled={!mixerEnabled}
          mutePressed={Boolean(selected?.muted) || audioMoved}
          onMute={toggleMute}
          unlinkDisabled={!canUnlink}
          onUnlink={edits.unlinkSelected}
          gainPercent={mixerEnabled ? gainPercent : 100}
          gainDisabled={!mixerEnabled}
          gainAriaText={mixerEnabled ? `${gainPercent} percent` : "No audio"}
          gainText={!selected ? "—" : !mixerEnabled ? "No audio" : selected.muted ? "Muted" : `${gainPercent}%`}
          onGain={handleGainInput}
          onGainCommit={handleGainCommit}
          normalizeDisabled={!mixerEnabled || busy}
          onNormalize={() => void normalizeSelected()}
        />
        <EditorPreviewFrame
          playing={playing}
          blank={blankPicture}
          hasClips={clips.length > 0}
          emptyTitle="No clips yet"
          emptyBody={
            showOpenFile
              ? "Drop a video or audio file, send a recording, or open a file."
              : "Drop a video or audio file, or send a recording."
          }
          playheadMs={playheadMs}
          totalMs={totalMs}
          onToggle={togglePlay}
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
          onSelect={setSelectedId}
          onSeek={edits.handleSeek}
          onScrub={edits.handleScrub}
          onTrim={edits.handleTrim}
          onTrimEnd={edits.handleTrimEnd}
          onFade={handleFade}
          onFadeEnd={handleFadeEnd}
          onReorder={edits.handleReorder}
          onMoveAudio={edits.handleMoveAudio}
          onMoveAudioEnd={edits.handleMoveAudioEnd}
          showFades
          showAudioTrack
          emptyHint={
            showOpenFile
              ? "Drop a video or audio file, send a recording, or open a file."
              : "Drop a video or audio file, or send a recording."
          }
        />
        <EditorError error={error} />
      </EditorShell>
    );
  },
);
