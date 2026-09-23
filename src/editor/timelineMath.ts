import type { EditorClip } from "../types";

export const MIN_CLIP_MS = 120;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 24;
export const CLIP_GAP_PX = 4;
export const TRACK_PAD_PX = 8;
export const FRAME_MS = 1000 / 30;
export const SKIP_MS = 1000;

export function clampZoom(value: number): number {
  return clamp(value, MIN_ZOOM, MAX_ZOOM);
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
 * Pack extra-audio clips onto the fewest rows so overlapping ranges do not share a line.
 * Adjacent half-open clips (`[a, b)` then `[b, c)`) stay on the same row.
 */
export function packAudioLanes(clips: EditorClip[]): AudioLanePack {
  const audio = audioTrackClips(clips);
  if (audio.length === 0) return { rowById: new Map(), rowCount: 0 };

  const ordered = [...audio].sort((a, b) => {
    const start = audioClipStart(a) - audioClipStart(b);
    if (start !== 0) return start;
    const longer = clipDuration(b) - clipDuration(a);
    if (longer !== 0) return longer;
    return a.id.localeCompare(b.id);
  });

  const laneEnds: number[] = [];
  const rowById = new Map<string, number>();
  for (const clip of ordered) {
    const start = audioClipStart(clip);
    const end = audioClipEnd(clip);
    let row = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (row < 0) {
      row = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[row] = end;
    }
    rowById.set(clip.id, row);
  }
  return { rowById, rowCount: laneEnds.length };
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

export function snapThresholdMs(pxPerMs: number): number {
  return clamp(10 / Math.max(pxPerMs, 0.001), 40, 220);
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
