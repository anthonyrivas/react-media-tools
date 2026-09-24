import { isSafariLike } from "../browser";
import type { RecorderStatus } from "../types";

export function createSerialQueue() {
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const run = queue.then(() => work());
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  return { enqueue };
}

export function recordingDurationMs(input: {
  status: RecorderStatus;
  startedAt: number;
  pausedAt: number;
  pausedMs: number;
  lastDurationMs?: number;
  now?: number;
}): number {
  if (input.status === "idle" || input.status === "preview" || !input.startedAt) {
    return input.lastDurationMs ?? 0;
  }
  const now = input.now ?? performance.now();
  const pausedPortion =
    input.status === "paused" && input.pausedAt
      ? input.pausedMs + (now - input.pausedAt)
      : input.pausedMs;
  return Math.max(0, now - input.startedAt - pausedPortion);
}

export function pauseMediaRecorder(
  recorder: MediaRecorder | null,
  status: RecorderStatus,
): number | null {
  if (status !== "recording" || !recorder) return null;
  if (typeof recorder.pause !== "function") return null;
  if (recorder.state === "recording") recorder.pause();
  return performance.now();
}

export function resumeMediaRecorder(
  recorder: MediaRecorder | null,
  status: RecorderStatus,
  pausedAt: number,
  pausedMs: number,
): { pausedMs: number } | null {
  if (status !== "paused" || !recorder) return null;
  if (typeof recorder.resume === "function" && recorder.state === "paused") {
    recorder.resume();
  }
  return {
    pausedMs: pausedAt ? pausedMs + (performance.now() - pausedAt) : pausedMs,
  };
}

export function startChunkRecorder(
  stream: MediaStream,
  options: {
    mimeType?: string;
    videoBitsPerSecond?: number;
    audioBitsPerSecond?: number;
  },
  onData: (event: BlobEvent) => void,
): MediaRecorder {
  const recorder = new MediaRecorder(stream, {
    mimeType: options.mimeType || undefined,
    videoBitsPerSecond: options.videoBitsPerSecond,
    audioBitsPerSecond: options.audioBitsPerSecond,
  });
  recorder.addEventListener("dataavailable", onData);
  if (isSafariLike()) recorder.start();
  else recorder.start(250);
  return recorder;
}

export function collectRecorderBlob(
  recorder: MediaRecorder,
  chunks: Blob[],
  fallbackMime: string,
): Promise<{ mimeType: string; blob: Blob }> {
  return new Promise((resolve, reject) => {
    recorder.addEventListener(
      "stop",
      () => {
        try {
          const mimeType = recorder.mimeType || fallbackMime;
          resolve({ mimeType, blob: new Blob(chunks, { type: mimeType }) });
        } catch (error) {
          reject(error);
        }
      },
      { once: true },
    );
    if (recorder.state !== "inactive") recorder.stop();
  });
}

export function startStatusTick(emit: () => void): () => void {
  const tick = window.setInterval(emit, 100);
  return () => window.clearInterval(tick);
}

export function appendRecorderChunk(chunks: Blob[], event: BlobEvent): void {
  if (event.data.size > 0) chunks.push(event.data);
}
