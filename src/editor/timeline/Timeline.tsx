import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { IconButton } from "../../IconButton";
import { IconMinus, IconPlus } from "../../icons";
import type { EditorClip } from "../../types";
import { formatPrecise } from "../../utils";
import { shortcutMod } from "../shared/editorDom";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  FIT_ZOOM,
  audioClipStart,
  audioTrackClips,
  clipStartMs,
  packAudioLanes,
  videoTrackClips,
} from "./timelineMath";
import { formatZoom, rulerTicks } from "./timelineView";
import { FadeTooltip, TimelineClip, TrimTooltip } from "./TimelineClip";
import { useTimelineInteraction } from "./useTimelineInteraction";
import type { WaveformPeaks } from "../shared/waveform";

export type TimelineSource = {
  id: string;
  name: string;
  durationMs: number;
  thumb?: string;
  peaks?: WaveformPeaks;
  hasAudio?: boolean;
};

export type TimelineHandle = {
  zoomBy: (factor: number) => void;
  zoomFit: () => void;
};

type TimelineProps = {
  clips: EditorClip[];
  sources: Record<string, TimelineSource>;
  thumbs?: Record<string, string>;
  selectedId: string | null;
  playheadMs: number;
  emptyHint?: string;
  showFades?: boolean;
  onSelect: (id: string) => void;
  onSeek: (ms: number) => void;
  onScrub: (ms: number) => void;
  onTrim: (id: string, inMs: number, outMs: number, edge: "in" | "out") => void;
  onTrimEnd: () => void;
  onFade?: (id: string, fadeInMs: number, fadeOutMs: number) => void;
  onFadeEnd?: () => void;
  onReorder: (from: number, to: number) => void;
  showAudioTrack?: boolean;
  onMoveAudio?: (id: string, startMs: number) => void;
  onMoveAudioEnd?: () => void;
};

export const Timeline = forwardRef<TimelineHandle, TimelineProps>(function Timeline(
  {
    clips,
    sources,
    thumbs,
    selectedId,
    playheadMs,
    emptyHint = "Drop a video, send a recording, or open a file.",
    showFades = false,
    onSelect,
    onSeek,
    onScrub,
    onTrim,
    onTrimEnd,
    onFade,
    onFadeEnd,
    onReorder,
    showAudioTrack = false,
    onMoveAudio,
    onMoveAudioEnd,
  },
  ref,
) {
  const extraAudio = useMemo(() => audioTrackClips(clips), [clips]);
  const videoClips = useMemo(() => videoTrackClips(clips), [clips]);
  const audioLanesRef = useRef<Map<string, number>>(new Map());
  const packedAudio = useMemo(() => {
    const packed = packAudioLanes(extraAudio, audioLanesRef.current);
    audioLanesRef.current = packed.rowById;
    return packed;
  }, [extraAudio]);
  const audioRowCount = showAudioTrack ? Math.max(1, packedAudio.rowCount) : 0;
  const {
    scrollerRef,
    trackRef,
    drag,
    zoom,
    applyZoom,
    zoomFit,
    pps,
    innerWidth,
    layoutTotal,
    total,
    holdLayout,
    playheadLeft,
    dropIndex,
    snapTrimId,
    trimTip,
    fadeTip,
    setFadeTip,
    beginTrim,
    beginScrub,
  } = useTimelineInteraction({
    clips,
    sources,
    playheadMs,
    showAudioTrack,
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
  });
  useImperativeHandle(ref, () => ({ zoomBy: (factor) => applyZoom(zoom * factor), zoomFit }), [applyZoom, zoom, zoomFit]);

  const ticks = useMemo(() => rulerTicks(layoutTotal, pps), [layoutTotal, pps]);

  return (
    <div className="rmt-timeline">
      <div className="rmt-timeline__bar">
        <div className="rmt-timeline__hint">
          {total <= 0
            ? emptyHint
            : `${Math.max(1, Math.round(layoutTotal / 1000))}s · ←/→ scrub · pinch or ${shortcutMod()}+scroll to zoom`}
        </div>
        <div className="rmt-timeline__zoom" role="group" aria-label="Timeline zoom">
          <IconButton
            label="Zoom out"
            keyshortcuts="Minus"
            disabled={zoom <= MIN_ZOOM || !clips.length}
            title="Zoom out (–)"
            onClick={() => applyZoom(1 / 1.25)}
          >
            <IconMinus />
          </IconButton>
          <span className="rmt-timeline__zoom-label" aria-live="polite" aria-atomic="true">
            {formatZoom(zoom)}
          </span>
          <IconButton
            label="Zoom in"
            keyshortcuts="Equal"
            disabled={zoom >= MAX_ZOOM || !clips.length}
            title="Zoom in (=)"
            onClick={() => applyZoom(1.25)}
          >
            <IconPlus />
          </IconButton>
          <button
            type="button"
            className="rmt-btn"
            disabled={zoom === FIT_ZOOM || !clips.length}
            aria-keyshortcuts="Digit0"
            onClick={zoomFit}
            title="Fit timeline (0)"
          >
            Fit
          </button>
        </div>
      </div>
      <div className="rmt-timeline__scroller" ref={scrollerRef}>
        <div className="rmt-timeline__inner" style={{ width: innerWidth || "100%" }}>
          <div className="rmt-timeline__ruler" onPointerDown={beginScrub} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.ms}
                className="rmt-timeline__tick"
                style={{ left: tick.ms * pps }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div
            className="rmt-timeline__track"
            ref={trackRef}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) beginScrub(event);
            }}
          >
            <div
              className="rmt-timeline__lane rmt-timeline__lane--video"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) beginScrub(event);
              }}
            >
            {videoClips.map((clip, index) => (
              <TimelineClip
                key={clip.id}
                variant="video"
                clip={clip}
                index={index}
                start={clipStartMs(clips, clips.findIndex((item) => item.id === clip.id))}
                source={sources[clip.sourceId]}
                thumb={thumbs?.[clip.id] ?? sources[clip.sourceId]?.thumb}
                selected={selectedId === clip.id}
                dropTarget={dropIndex === index}
                snapTarget={snapTrimId === clip.id}
                holdLayout={holdLayout}
                drag={drag}
                pps={pps}
                playheadMs={playheadMs}
                allowFades={Boolean(showFades && onFade)}
                clips={clips}
                onSelect={onSelect}
                beginTrim={beginTrim}
                setFadeTip={setFadeTip}
              />
            ))}
            </div>
            {showAudioTrack &&
              Array.from({ length: audioRowCount }, (_, row) => (
              <div
                key={`audio-${row}`}
                className="rmt-timeline__lane rmt-timeline__lane--audio"
                data-audio-row={row}
                aria-label={audioRowCount > 1 ? `Audio row ${row + 1}` : "Audio track"}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) beginScrub(event);
                }}
              >
                {extraAudio.length === 0 && (
                  <div className="rmt-timeline__lane-empty">Audio track · drop audio or unlink a clip</div>
                )}
                {extraAudio
                  .filter((clip) => (packedAudio.rowById.get(clip.id) ?? 0) === row)
                  .map((clip) => (
                    <TimelineClip
                      key={clip.id}
                      variant="audio"
                      clip={clip}
                      index={clips.findIndex((item) => item.id === clip.id)}
                      start={audioClipStart(clip)}
                      source={sources[clip.sourceId]}
                      selected={selectedId === clip.id}
                      snapTarget={snapTrimId === clip.id}
                      holdLayout={holdLayout}
                      drag={drag}
                      pps={pps}
                      playheadMs={playheadMs}
                      allowFades={Boolean(showFades && onFade)}
                      clips={clips}
                      onSelect={onSelect}
                      beginTrim={beginTrim}
                      setFadeTip={setFadeTip}
                    />
                  ))}
              </div>
              ))}
            {total > 0 && (
              <div
                className="rmt-timeline__playhead"
                role="slider"
                tabIndex={0}
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, Math.round(total))}
                aria-valuenow={Math.round(playheadMs)}
                aria-valuetext={`${formatPrecise(playheadMs)} of ${formatPrecise(total)}`}
                style={{ left: playheadLeft }}
                onPointerDown={beginScrub}
              />
            )}
          </div>
        </div>
      </div>
      {trimTip && <TrimTooltip tip={trimTip} />}
      {fadeTip && <FadeTooltip tip={fadeTip} />}
    </div>
  );
});

