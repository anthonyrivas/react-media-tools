import type { EditorClip } from "../types";

export const MIN_CLIP_MS = 120;
export const MIN_ZOOM = 0.5;
export const FIT_ZOOM = 1;
export const MAX_ZOOM = 24;
export const CLIP_GAP_PX = 4;
export const TRACK_PAD_PX = 8;
export const END_PAD_PX = 50;
export const FRAME_MS = 1000 / 30;
export const SKIP_MS = 1000;

export function clampZoom(value: number): number {
  return clamp(Math.round(value * 10) / 10, MIN_ZOOM, MAX_ZOOM);
}

/** Pixels per ms so 1× leaves `END_PAD_PX` after the last clip. */
export function timelinePps(viewWidth: number, totalMs: number, zoom: number): number {
  const usable = Math.max(1, viewWidth - TRACK_PAD_PX * 2 - END_PAD_PX);
  return totalMs > 0 ? (usable / totalMs) * zoom : 0;
}

export function timelineInnerWidth(viewWidth: number, totalMs: number, pps: number): number {
  if (totalMs <= 0 || pps <= 0) return viewWidth;
  return Math.max(viewWidth, TRACK_PAD_PX * 2 + totalMs * pps + END_PAD_PX);
}

export type ClipHit = {
  clip: EditorClip;
  index: number;
  startMs: number;
  offsetMs: number;
};

export function clipDuration(clip: EditorClip): number {
  return Math.max(0, clip.outMs - clip.inMs);
}

export function isAudioClip(clip: EditorClip): boolean {
  return clip.kind === "audio";
}

export function isVideoClip(clip: EditorClip): boolean {
  return !isAudioClip(clip);
}

export function videoTrackClips(clips: EditorClip[]): EditorClip[] {
  return clips.filter(isVideoClip);
}

export function audioTrackClips(clips: EditorClip[]): EditorClip[] {
  return clips.filter(isAudioClip);
}

export type AudioLanePack = {
  rowById: Map<string, number>;
  rowCount: number;
};

/**
 * Pack extra-audio clips onto rows so overlapping ranges do not share a line.
 * Adjacent half-open clips (`[a, b)` then `[b, c)`) can share a row.
 * Row order follows clip insertion, not duration, and `previous` keeps a clip
 * on its last row so trims do not reshuffle lanes.
 */
export function packAudioLanes(
  clips: EditorClip[],
  previous?: ReadonlyMap<string, number>,
): AudioLanePack {
  const audio = audioTrackClips(clips);
  if (audio.length === 0) return { rowById: new Map(), rowCount: 0 };

  const rowById = new Map<string, number>();

  const overlapsOnRow = (row: number, clip: EditorClip): boolean => {
    const start = audioClipStart(clip);
    const end = audioClipEnd(clip);
    for (const other of audio) {
      if (other.id === clip.id || rowById.get(other.id) !== row) continue;
      if (start < audioClipEnd(other) && audioClipStart(other) < end) return true;
    }
    return false;
  };

  const firstFit = (clip: EditorClip): number => {
    let row = 0;
    while (overlapsOnRow(row, clip)) row += 1;
    return row;
  };

  for (const clip of audio) {
    const preferred = previous?.get(clip.id);
    const row = preferred != null && !overlapsOnRow(preferred, clip) ? preferred : firstFit(clip);
    rowById.set(clip.id, row);
  }

  const used = [...new Set(rowById.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((row, index) => [row, index]));
  for (const [id, row] of rowById) {
    rowById.set(id, remap.get(row) ?? row);
  }

  return { rowById, rowCount: used.length };
}

/** Picture clips whose soundtrack was moved onto the extra track. */
export function hasDetachedAudio(clips: EditorClip[], clipId: string): boolean {
  return clips.some((item) => isAudioClip(item) && item.linkedClipId === clipId);
}

/** Whether mixer gain/mute/normalize would affect this clip. */
export function clipHasPlayableAudio(
  clips: EditorClip[],
  clip: EditorClip,
  sourceHasAudio = true,
): boolean {
  if (isAudioClip(clip)) return true;
  if (!sourceHasAudio) return false;
  return !hasDetachedAudio(clips, clip.id);
}

export function audioClipStart(clip: EditorClip): number {
  return Math.max(0, clip.startMs ?? 0);
}

export function audioClipEnd(clip: EditorClip): number {
  return audioClipStart(clip) + clipDuration(clip);
}

/** Copy a clip with a new id. Extra-audio copies sit just after the original. */
export function duplicateClip(clip: EditorClip, id: string): EditorClip {
  const copy: EditorClip = {
    id,
    sourceId: clip.sourceId,
    inMs: clip.inMs,
    outMs: clip.outMs,
    volume: clip.volume,
    muted: clip.muted,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
  };
  if (isAudioClip(clip)) {
    copy.kind = "audio";
    copy.startMs = audioClipEnd(clip);
  } else if (clip.kind) {
    copy.kind = clip.kind;
  }
  return copy;
}

export function totalDuration(clips: EditorClip[]): number {
  return videoTrackClips(clips).reduce((sum, clip) => sum + clipDuration(clip), 0);
}

export function timelineDuration(clips: EditorClip[]): number {
  const picture = totalDuration(clips);
  const audioEnd = audioTrackClips(clips).reduce((max, clip) => Math.max(max, audioClipEnd(clip)), 0);
  return Math.max(picture, audioEnd);
}

export function audioClipsAt(clips: EditorClip[], ms: number): EditorClip[] {
  return audioTrackClips(clips).filter((clip) => {
    const start = audioClipStart(clip);
    const end = audioClipEnd(clip);
    return ms >= start && ms < end;
  });
}

export function clipStartMs(clips: EditorClip[], index: number): number {
  const clip = clips[index];
  if (!clip) return 0;
  if (isAudioClip(clip)) return audioClipStart(clip);
  const video = videoTrackClips(clips);
  const videoIndex = video.findIndex((item) => item.id === clip.id);
  let acc = 0;
  for (let i = 0; i < videoIndex && i < video.length; i += 1) {
    const item = video[i];
    if (item) acc += clipDuration(item);
  }
  return acc;
}

/** Timeline ranges are half-open `[start, end)` so a split point belongs to the right-hand clip. */
export function locateClip(clips: EditorClip[], ms: number): ClipHit | null {
  const video = videoTrackClips(clips);
  if (!video.length) return null;
  const total = totalDuration(clips);
  const time = clamp(ms, 0, total);
  let acc = 0;

  for (let videoIndex = 0; videoIndex < video.length; videoIndex += 1) {
    const clip = video[videoIndex];
    if (!clip) continue;
    const duration = clipDuration(clip);
    const isLast = videoIndex === video.length - 1;
    const end = acc + duration;
    const inRange = isLast ? time <= end : time < end;
    if (inRange) {
      const index = clips.findIndex((item) => item.id === clip.id);
      return {
        clip,
        index: index < 0 ? videoIndex : index,
        startMs: acc,
        offsetMs: duration === 0 ? 0 : clamp(time - acc, 0, duration),
      };
    }
    acc = end;
  }

  const lastIndex = video.length - 1;
  const last = video[lastIndex];
  if (!last) return null;
  const index = clips.findIndex((item) => item.id === last.id);
  return {
    clip: last,
    index: index < 0 ? lastIndex : index,
    startMs: clipStartMs(clips, index < 0 ? lastIndex : index),
    offsetMs: clipDuration(last),
  };
}

export function cutTimes(clips: EditorClip[]): number[] {
  const times = [0];
  let acc = 0;
  for (const clip of videoTrackClips(clips)) {
    acc += clipDuration(clip);
    times.push(acc);
  }
  return times;
}

export const SNAP_PX = 10;

export function snapThresholdMs(pxPerMs: number): number {
  return SNAP_PX / Math.max(pxPerMs, 0.001);
}

/** Timeline time under a pointer, using the padded inner track. */
export function timelineMsAtX(clientX: number, originLeft: number, padPx: number, pps: number): number {
  if (pps <= 0) return 0;
  return Math.max(0, (clientX - originLeft - padPx) / pps);
}

export function snapValue(ms: number, targets: number[], thresholdMs: number): number {
  let nearest = ms;
  let best = thresholdMs;
  for (const target of targets) {
    const distance = Math.abs(target - ms);
    if (distance <= best) {
      best = distance;
      nearest = target;
    }
  }
  return nearest;
}

/** Extra-audio and cross-track pairs keep alignment; magnetic same-track clips slide after trim. */
export function canSnapTrimToHovered(
  trimming: EditorClip,
  hovered: EditorClip,
  showAudioTrack: boolean,
): boolean {
  if (trimming.id === hovered.id) return false;
  if (!showAudioTrack) return false;
  if (isVideoClip(trimming) && isVideoClip(hovered)) return false;
  return true;
}

/** Side-by-side extra audio should snap to the shared edge, not only the far matching edge. */
export function hoveredTrimUsesBothEdges(trimming: EditorClip, hovered: EditorClip): boolean {
  return isAudioClip(trimming) && isAudioClip(hovered);
}

/** Source-time snap points for a hovered clip. Extra-audio pairs include start and end. */
export function hoveredTrimSourceTimes(input: {
  edge: "in" | "out";
  originIn: number;
  clipStartMs: number;
  hoveredStartMs: number;
  hoveredEndMs: number;
  bothEdges?: boolean;
}): number[] {
  const { edge, originIn, clipStartMs: start, hoveredStartMs, hoveredEndMs, bothEdges = false } = input;
  const times = bothEdges
    ? [hoveredStartMs, hoveredEndMs]
    : [edge === "in" ? hoveredStartMs : hoveredEndMs];
  return times.map((time) => originIn + (time - start));
}

export function clampTrimIn(nextIn: number, originOut: number): number {
  return clamp(nextIn, 0, originOut - MIN_CLIP_MS);
}

export function clampTrimOut(nextOut: number, originIn: number, sourceDurationMs: number): number {
  return clamp(nextOut, originIn + MIN_CLIP_MS, sourceDurationMs);
}

/** Map a timeline time onto the dragging clip’s in or out, then clamp. */
export function trimToTimelineMs(input: {
  edge: "in" | "out";
  originIn: number;
  originOut: number;
  clipStartMs: number;
  sourceDurationMs: number;
  timelineMs: number;
}): { inMs: number; outMs: number } {
  const sourceTime = input.originIn + (input.timelineMs - input.clipStartMs);
  if (input.edge === "in") {
    return { inMs: clampTrimIn(sourceTime, input.originOut), outMs: input.originOut };
  }
  return {
    inMs: input.originIn,
    outMs: clampTrimOut(sourceTime, input.originIn, input.sourceDurationMs),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
