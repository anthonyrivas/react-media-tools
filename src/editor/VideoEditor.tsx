import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import type { EditorClip, EditorInput, ExportResult } from "../types";
import { droppedMediaFiles } from "./shared/editorDom";
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
import { type TimelineHandle } from "./timeline/Timeline";
import { VideoEditorLayout } from "./video/VideoEditorChrome";
import { videoEditorEmptyCopy, videoMixerView } from "./video/videoEditorView";
import { clipHasPlayableAudio, timelineDuration, videoTrackClips } from "./timeline/timelineMath";

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
    const mixer = videoMixerView(clips, selected, selectedSource?.hasAudio);
    const copy = videoEditorEmptyCopy(showOpenFile);

    return (
      <VideoEditorLayout
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
        pictureCount={pictureClips.length}
        selected={selected}
        mixer={mixer}
        canUndo={canUndo}
        canRedo={canRedo}
        progress={progress}
        lastExport={Boolean(lastExport)}
        playing={playing}
        blankPicture={blankPicture}
        emptyBody={copy.emptyBody}
        emptyHint={copy.emptyHint}
        playheadMs={playheadMs}
        totalMs={totalMs}
        videoRef={videoRef}
        extraAudio={extraAudio}
        extraAudioEls={extraAudioEls}
        sourceMap={sourceMap}
        clipThumbs={clipThumbs}
        selectedId={selectedId}
        timelineRef={timelineRef}
        error={error}
        onSplit={() => edits.split()}
        onSplitAll={() => edits.split(true)}
        onDuplicate={edits.duplicateSelected}
        onDelete={edits.deleteSelected}
        onUndo={undo}
        onRedo={redo}
        onOpen={() => fileRef.current?.click()}
        onFiles={(files) => files.forEach((file) => void addSource(file, file.name))}
        onExport={() => void edits.exportVideo()}
        onDownload={() => edits.download()}
        onMute={toggleMute}
        onUnlink={edits.unlinkSelected}
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
        onMoveAudio={edits.handleMoveAudio}
        onMoveAudioEnd={edits.handleMoveAudioEnd}
      />
    );
  },
);
