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

export function totalDuration(clips: EditorClip[]): number {
  return clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
}

export function clipStartMs(clips: EditorClip[], index: number): number {
  let acc = 0;
  for (let i = 0; i < index && i < clips.length; i += 1) {
    const clip = clips[i];
    if (clip) acc += clipDuration(clip);
  }
  return acc;
}

/** Timeline ranges are half-open `[start, end)` so a split point belongs to the right-hand clip. */
export function locateClip(clips: EditorClip[], ms: number): ClipHit | null {
  if (!clips.length) return null;
  const total = totalDuration(clips);
  const time = clamp(ms, 0, total);
  let acc = 0;

  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (!clip) continue;
    const duration = clipDuration(clip);
    const isLast = index === clips.length - 1;
    const end = acc + duration;
    const inRange = isLast ? time <= end : time < end;
    if (inRange) {
      return {
        clip,
        index,
        startMs: acc,
        offsetMs: duration === 0 ? 0 : clamp(time - acc, 0, duration),
      };
    }
    acc = end;
  }

  const lastIndex = clips.length - 1;
  const last = clips[lastIndex];
  if (!last) return null;
  const startMs = clipStartMs(clips, lastIndex);
  return {
    clip: last,
    index: lastIndex,
    startMs,
    offsetMs: clipDuration(last),
  };
}

export function cutTimes(clips: EditorClip[]): number[] {
  const times = [0];
  let acc = 0;
  for (const clip of clips) {
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
