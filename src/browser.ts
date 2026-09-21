import type { BrowserCapabilities } from "./types";

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=h264,aac",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];

const VIDEO_ONLY_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4;codecs=h264",
  "video/mp4",
];

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

const SAFARI_AUDIO_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
  ...AUDIO_MIME_CANDIDATES,
];

export function pickMimeType(options?: { audio?: boolean }): string {
  if (typeof MediaRecorder === "undefined") return "";
  const videoOnly = options?.audio === false;
  const safari = isSafariLike();
  const list = safari
    ? videoOnly
      ? [
          "video/mp4;codecs=avc1.42001e",
          "video/mp4;codecs=h264",
          "video/mp4",
          ...VIDEO_ONLY_MIME_CANDIDATES,
        ]
      : [
          "video/mp4;codecs=h264,aac",
          "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
          "video/mp4",
          ...MIME_CANDIDATES,
        ]
    : videoOnly
      ? VIDEO_ONLY_MIME_CANDIDATES
      : MIME_CANDIDATES;
  return list.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const list = isSafariLike() ? SAFARI_AUDIO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES;
  return list.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function extensionForMime(mime: string): string {
  const type = mime.toLowerCase();
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.startsWith("audio/") && (type.includes("mp4") || type.includes("m4a") || type.includes("aac"))) {
    return "m4a";
  }
  if (type.includes("mp4")) return "mp4";
  return "webm";
}

export function filenameFor(prefix: string, mime: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${prefix}-${stamp}.${extensionForMime(mime)}`;
}

export function isSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|Chromium|Edg|Android/i.test(ua);
}

function isFirefox(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Firefox/i.test(navigator.userAgent);
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** Display-capture audio is reliably available only in Chromium desktops. */
export function supportsDisplayAudio(): boolean {
  if (typeof navigator === "undefined") return false;
  if (isIOS() || isSafariLike() || isFirefox()) return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export function detectCapabilities(): BrowserCapabilities {
  const hasNavigator = typeof navigator !== "undefined";
  const mediaDevices = hasNavigator && !!navigator.mediaDevices;
  const camera =
    mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
  const screen =
    mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";
  const mediaRecorder = typeof MediaRecorder !== "undefined";
  const canvasCapture =
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function";
  const systemAudio = screen && supportsDisplayAudio();
  const mimeType = pickMimeType();

  const notes: BrowserCapabilities["notes"] = {};
  if (!camera) {
    notes.camera = "Camera capture is not available in this browser.";
    notes.microphone = "Microphone capture is not available in this browser.";
  }
  if (!screen) {
    notes.screen = "Screen capture is not available in this browser.";
  } else if (isIOS()) {
    notes.screen = "Screen capture is not available on iOS.";
  }
  if (!systemAudio) {
    notes.systemAudio = isSafariLike()
      ? "Safari cannot capture system audio. Use the microphone, or record in Chrome or Edge."
      : isFirefox()
        ? "Firefox cannot capture system audio. Use the microphone, or record in Chrome or Edge."
        : "System audio capture is not supported here. Chrome or Edge on desktop can include it when you share a tab or screen.";
  }
  if (!mediaRecorder || !canvasCapture || !mimeType) {
    notes.recording = "In-browser recording is not fully supported in this browser.";
  }

  return {
    mediaDevices,
    camera,
    microphone: camera,
    screen: screen && !isIOS(),
    systemAudio,
    mediaRecorder,
    canvasCapture,
    mimeType,
    notes,
  };
}

export function suggestedBitrate(width: number, height: number): number {
  const pixels = Math.max(1, width * height);
  const base = pixels >= 1920 * 1080 ? 8_000_000 : pixels >= 1280 * 720 ? 5_000_000 : 2_500_000;
  return base;
}
