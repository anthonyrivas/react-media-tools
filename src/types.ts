export type SourceName = "camera" | "screen" | "microphone" | "systemAudio";

export type RecorderStatus = "idle" | "preview" | "recording" | "paused";

export type CameraOverlay = {
  /** Left edge as a fraction of the output width (0–1). */
  x: number;
  /** Top edge as a fraction of the output height (0–1). */
  y: number;
  /** Overlay width as a fraction of the output width (0–1). Height follows camera aspect. */
  width: number;
};

export type BrowserCapabilities = {
  mediaDevices: boolean;
  camera: boolean;
  microphone: boolean;
  screen: boolean;
  systemAudio: boolean;
  mediaRecorder: boolean;
  canvasCapture: boolean;
  mimeType: string;
  notes: Partial<Record<SourceName | "recording", string>>;
};

export type RecordingResult = {
  blob: Blob;
  mimeType: string;
  filename: string;
  durationMs: number;
  width: number;
  height: number;
};

export type AudioRecordingResult = {
  blob: Blob;
  mimeType: string;
  filename: string;
  durationMs: number;
};

export type EditorInput = {
  id?: string;
  file: Blob;
  name?: string;
  durationMs?: number;
  width?: number;
  height?: number;
};

export type EditorClip = {
  id: string;
  sourceId: string;
  inMs: number;
  outMs: number;
  /** Linear gain. `1` is unity. Omitted means unity. */
  volume?: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Defaults to `"video"`. Audio-track clips sit under the picture. */
  kind?: "video" | "audio";
  /** Timeline start for audio-track clips. Video clips stay magnetic and ignore this. */
  startMs?: number;
  /** Video clip this audio was unlinked from, if any. */
  linkedClipId?: string;
};

export type ExportResult = {
  blob: Blob;
  mimeType: string;
  filename: string;
  durationMs: number;
  width: number;
  height: number;
};
