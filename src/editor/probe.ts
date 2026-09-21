import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
} from "mediabunny";

export type ProbedMedia = {
  durationMs: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export type ProbeHints = {
  durationMs?: number;
  width?: number;
  height?: number;
};

export async function probeMedia(file: Blob, hints?: ProbeHints): Promise<ProbedMedia> {
  const fromDecoder = await probeWithDecoder(file);
  const fromElement =
    !fromDecoder || fromDecoder.durationMs <= 0 ? await probeWithElement(file) : null;

  const durationMs =
    positive(hints?.durationMs) ??
    positive(fromDecoder?.durationMs) ??
    positive(fromElement?.durationMs) ??
    0;
  const width = hints?.width && hints.width > 0 ? hints.width : fromDecoder?.width || fromElement?.width || 1280;
  const height = hints?.height && hints.height > 0 ? hints.height : fromDecoder?.height || fromElement?.height || 720;

  if (durationMs <= 0) {
    throw new Error("Could not read this video. Try another file, or record again.");
  }

  return {
    durationMs,
    width,
    height,
    hasAudio: fromDecoder?.hasAudio ?? fromElement?.hasAudio ?? false,
  };
}

async function probeWithDecoder(file: Blob): Promise<ProbedMedia | null> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  try {
    const duration = await input.computeDuration();
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      durationMs: Math.max(0, duration * 1000),
      width: video ? await video.getDisplayWidth() : 1280,
      height: video ? await video.getDisplayHeight() : 720,
      hasAudio: Boolean(audio),
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

async function probeWithElement(file: Blob): Promise<ProbedMedia | null> {
  const session = openVideoBlob(file);
  try {
    await waitForVideo(session.video, "loadeddata", 8000);
    const durationMs = videoDurationMs(session.video);
    const width = session.video.videoWidth || 0;
    const height = session.video.videoHeight || 0;
    if (!width && durationMs <= 0) return null;
    return {
      durationMs,
      width: width || 1280,
      height: height || 720,
      hasAudio: false,
    };
  } catch {
    return null;
  } finally {
    session.dispose();
  }
}

export async function extractThumbnail(file: Blob, timeMs: number): Promise<string | undefined> {
  const fromDecoder = await thumbnailFromDecoder(file, timeMs);
  if (fromDecoder) return fromDecoder;
  return thumbnailFromElement(file, timeMs);
}

async function thumbnailFromDecoder(file: Blob, timeMs: number): Promise<string | undefined> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || !(await video.canDecode())) return undefined;
    const duration = await video.computeDuration();
    const timestamp = Math.min(Math.max(timeMs / 1000, 0), Math.max(0, duration - 0.05));
    const sink = new CanvasSink(video, { width: 240, fit: "cover" });
    const frame = await sink.getCanvas(timestamp);
    if (!frame) return undefined;
    const canvas = frame.canvas;
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
      return URL.createObjectURL(blob);
    }
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return undefined;
  } finally {
    input.dispose();
  }
}

async function thumbnailFromElement(file: Blob, timeMs: number): Promise<string | undefined> {
  const session = openVideoBlob(file);
  try {
    await waitForVideo(session.video, "loadeddata", 4000);
    await seekVideo(session.video, timeMs / 1000);
    if (!session.video.videoWidth) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = Math.max(1, Math.round((240 * session.video.videoHeight) / session.video.videoWidth));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(session.video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return undefined;
  } finally {
    session.dispose();
  }
}

export async function rasterizeClip(
  file: Blob,
  startSec: number,
  endSec: number,
  onFrame: (video: HTMLVideoElement) => Promise<void> | void,
): Promise<number> {
  const session = openVideoBlob(file);
  const video = session.video;
  const frameDuration = 1 / 30;
  let written = 0;
  try {
    await waitForVideo(video, "loadeddata", 8000);
    if (startSec > 0.04) await seekVideo(video, startSec);

    const seekWorked = Math.abs(video.currentTime - startSec) < 0.45 || startSec < 0.2;
    if (!seekWorked) {
      await video.play().catch(() => undefined);
      await untilVideoTime(video, startSec);
    }

    const stopAt = Math.max(startSec + frameDuration, endSec);
    if (seekWorked && video.paused) {
      for (let time = Math.max(video.currentTime, startSec); time < stopAt - 0.005; time += frameDuration) {
        await seekVideo(video, time);
        await onFrame(video);
        written += frameDuration;
      }
    } else {
      if (video.paused) await video.play().catch(() => undefined);
      while (!video.ended && video.currentTime < stopAt - 0.01) {
        await onFrame(video);
        written += frameDuration;
        await nextVideoFrame(video);
      }
    }
    video.pause();
    return Math.max(written, endSec - startSec);
  } finally {
    session.dispose();
  }
}

function openVideoBlob(file: Blob): { video: HTMLVideoElement; dispose: () => void } {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  return {
    video,
    dispose() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

function videoDurationMs(video: HTMLVideoElement): number {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration * 1000;
  if (video.seekable.length > 0) {
    const end = video.seekable.end(video.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end * 1000;
  }
  return 0;
}

function waitForVideo(video: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not decode this video."));
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
    if (event === "loadeddata" && video.readyState >= 2) {
      cleanup();
      resolve();
    }
  });
}

function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  const target = Math.max(0, seconds);
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = Math.min(target, Math.max(0, video.duration - 0.04));
  } else {
    video.currentTime = target;
  }
  if (Math.abs(video.currentTime - target) < 0.04) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 400);
    video.addEventListener("seeked", finish, { once: true });
  });
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    if ("requestVideoFrameCallback" in video) {
      video.requestVideoFrameCallback(() => done());
    } else {
      requestAnimationFrame(() => done());
    }
  });
}

function untilVideoTime(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (video.ended || video.currentTime >= timeSec - 0.02) {
        resolve();
        return;
      }
      void nextVideoFrame(video).then(tick);
    };
    tick();
  });
}

function positive(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}
