import type { EditorClip } from "../../types";
import { clipHasPlayableAudio, hasDetachedAudio, isVideoClip } from "../timeline/timelineMath";

export function videoEditorEmptyCopy(showOpenFile: boolean): { emptyBody: string; emptyHint: string } {
  const text = showOpenFile
    ? "Drop a video or audio file, send a recording, or open a file."
    : "Drop a video or audio file, or send a recording.";
  return { emptyBody: text, emptyHint: text };
}

export type VideoMixerView = {
  mixerEnabled: boolean;
  gainPercent: number;
  canUnlink: boolean;
  audioMoved: boolean;
  mutePressed: boolean;
  gainAriaText: string;
  gainText: string;
};

export function videoMixerView(
  clips: EditorClip[],
  selected: EditorClip | null,
  sourceHasAudio: boolean | undefined,
): VideoMixerView {
  const mixerEnabled =
    selected != null && clipHasPlayableAudio(clips, selected, sourceHasAudio !== false);
  const gainPercent = Math.round((selected?.volume ?? 1) * 100);
  const canUnlink = selected != null && mixerEnabled && isVideoClip(selected);
  const audioMoved = selected != null && isVideoClip(selected) && hasDetachedAudio(clips, selected.id);
  return {
    mixerEnabled,
    gainPercent,
    canUnlink,
    audioMoved,
    mutePressed: Boolean(selected?.muted) || audioMoved,
    gainAriaText: mixerEnabled ? `${gainPercent} percent` : "No audio",
    gainText: !selected ? "—" : !mixerEnabled ? "No audio" : selected.muted ? "Muted" : `${gainPercent}%`,
  };
}
