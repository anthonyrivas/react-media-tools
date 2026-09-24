import { waitForEvent } from "../utils";

export const DEFAULT_CANVAS = { width: 1280, height: 720 };

export function createHiddenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.className = "rmt-recorder__source-video";
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("aria-hidden", "true");
  return video;
}

export async function playVideo(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch {
    // Autoplay can fail if a track hasn't produced a frame yet; loadeddata retries below.
  }
  if (!video.videoWidth) {
    await waitForEvent(video, "loadeddata", 12000).catch(() => undefined);
  }
}

export function keepPlaying(video: HTMLVideoElement, destroyed: boolean): void {
  if (destroyed || !video.srcObject) return;
  if (video.paused || video.ended) void video.play().catch(() => undefined);
}

export function mountSourceVideo(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const host = canvas.parentElement ?? document.body;
  if (video.parentElement !== host) host.appendChild(video);
}

export function liveVideoImage(enabled: boolean, video: HTMLVideoElement): CanvasImageSource | null {
  if (enabled && video.readyState >= 2 && video.videoWidth > 0) return video;
  return null;
}

export function sourceCanvasSize(input: {
  screen: boolean;
  camera: boolean;
  screenWidth: number;
  screenHeight: number;
  cameraWidth: number;
  cameraHeight: number;
}): { width: number; height: number } {
  if (input.screen && input.screenWidth) {
    return { width: input.screenWidth, height: input.screenHeight };
  }
  if (input.camera && input.cameraWidth) {
    return { width: input.cameraWidth, height: input.cameraHeight };
  }
  return DEFAULT_CANVAS;
}

export type VideoFrameIds = { camera: number; screen: number };

export function watchVideoFrames(
  video: HTMLVideoElement,
  slot: "camera" | "screen",
  ids: VideoFrameIds,
  active: () => boolean,
  draw: () => void,
): void {
  stopVideoFrameWatch(video, slot, ids);
  if (!("requestVideoFrameCallback" in video) || !video.srcObject) return;
  const tick = () => {
    if (!active() || !video.srcObject) return;
    draw();
    ids[slot] = video.requestVideoFrameCallback(tick);
  };
  ids[slot] = video.requestVideoFrameCallback(tick);
}

export function stopVideoFrameWatch(
  video: HTMLVideoElement,
  slot: "camera" | "screen",
  ids: VideoFrameIds,
): void {
  const id = ids[slot];
  if (id && "cancelVideoFrameCallback" in video) {
    video.cancelVideoFrameCallback(id);
  }
  ids[slot] = 0;
}
