import type { RecorderStatus } from "../../types";
import { formatClock } from "../../utils";

export function videoRecorderStatusLabel(status: RecorderStatus, durationMs: number): string {
  if (status === "recording") return `REC ${formatClock(durationMs)}`;
  if (status === "paused") return `PAUSED ${formatClock(durationMs)}`;
  if (status === "preview") return "Preview";
  return "Idle";
}

export function videoRecorderStatusAnnounce(status: RecorderStatus): string {
  if (status === "recording") return "Recording";
  if (status === "paused") return "Recording paused";
  if (status === "preview") return "Preview";
  return "Recorder idle";
}

export function videoRecorderPreviewLabel(camera: boolean, screen: boolean): string {
  if (camera && screen) return "Camera over screen preview";
  if (camera) return "Camera preview";
  if (screen) return "Screen preview";
  return "Recorder preview";
}

export function microphoneArmed(microphone: boolean, wantMic: boolean, live: boolean): boolean {
  return microphone || (wantMic && !live);
}

export function systemAudioHint(systemAudio: boolean, systemAudioTrack: boolean, note?: string): string | undefined {
  if (systemAudio && !systemAudioTrack) return "Enable “Share audio” in the browser prompt.";
  return note;
}
