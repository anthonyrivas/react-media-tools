import type { RecorderStatus } from "../../types";
import { formatClock } from "../../utils";

export function audioRecorderStatusLabel(
  status: RecorderStatus,
  durationMs: number,
  hasRecording: boolean,
): string {
  if (status === "recording") return `REC ${formatClock(durationMs)}`;
  if (status === "paused") return `PAUSED ${formatClock(durationMs)}`;
  if (hasRecording) return `Ready ${formatClock(durationMs)}`;
  return "Idle";
}

export function audioRecorderStatusAnnounce(status: RecorderStatus, hasRecording: boolean): string {
  if (status === "recording") return "Recording audio";
  if (status === "paused") return "Audio recording paused";
  if (hasRecording) return "Audio take ready";
  return "Audio recorder idle";
}

export function audioRecorderEmptyCopy(hasRecording: boolean): { title: string; body: string } {
  if (hasRecording) {
    return {
      title: "Take ready",
      body: "Download the file, or start again to replace it.",
    };
  }
  return {
    title: "Start to record audio",
    body: "Uses the microphone. Stop to get an audio file.",
  };
}

export function audioRecorderStartHint(notes: { recording?: string; microphone?: string }): string | undefined {
  return notes.recording ?? notes.microphone;
}
