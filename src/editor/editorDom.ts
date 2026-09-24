import { uid } from "../utils";

const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv)$/i;
const AUDIO_FILE = /\.(mp3|m4a|wav|ogg|oga|aac|flac|weba|webm)$/i;

const blobIds = new WeakMap<Blob, string>();

export function sourceIdFor(file: Blob): string {
  const existing = blobIds.get(file);
  if (existing) return existing;
  const id = uid("src");
  blobIds.set(file, id);
  return id;
}

export function positiveMs(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(target.isContentEditable);
}

export function isFileDrag(event: { dataTransfer: DataTransfer | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function shortcutMod(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}

export function droppedMediaFiles(
  fileList: FileList | File[],
  mode: "video" | "audio",
): File[] {
  return [...fileList].filter((file) => {
    if (file.type.startsWith("audio/") || AUDIO_FILE.test(file.name)) return true;
    if (mode === "audio") return false;
    return file.type.startsWith("video/") || VIDEO_FILE.test(file.name);
  });
}

export function seekTo(media: HTMLMediaElement, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds)) return Promise.resolve();
  if (Math.abs(media.currentTime - seconds) < 0.04) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      media.removeEventListener("seeked", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 350);
    media.addEventListener("seeked", finish);
    media.currentTime = seconds;
  });
}
