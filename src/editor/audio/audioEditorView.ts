import type { EditorClip } from "../../types";

export function audioEditorEmptyBody(showOpenFile: boolean): string {
  return showOpenFile
    ? "Drop audio here, send a recording, or open a file."
    : "Drop audio here, or send a recording.";
}

export function audioEditorEmptyHint(showOpenFile: boolean): string {
  return showOpenFile
    ? "Drop audio, send a recording, or open a file."
    : "Drop audio, or send a recording.";
}

export function audioMixerText(selected: EditorClip | null, gainPercent: number): string {
  if (!selected) return "—";
  return selected.muted ? "Muted" : `${gainPercent}%`;
}
