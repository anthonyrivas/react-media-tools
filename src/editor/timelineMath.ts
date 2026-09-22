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

export function audioClipStart(clip: EditorClip): number {
  return Math.max(0, clip.startMs ?? 0);
}

export function audioClipEnd(clip: EditorClip): number {
  return audioClipStart(clip) + clipDuration(clip);
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
