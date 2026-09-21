export function uid(prefix = "id"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

export function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatPrecise(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const hundredths = Math.floor((clamped % 1000) / 10);
  return `${pad(minutes)}:${pad(seconds)}.${pad(hundredths)}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function waitForEvent(
  target: EventTarget,
  event: string,
  timeoutMs = 8000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      target.removeEventListener(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const onEvent = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      resolve();
    };

    target.addEventListener(event, onEvent);
  });
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function fitContain(
  sourceW: number,
  sourceH: number,
  destW: number,
  destH: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(destW / sourceW, destH / sourceH);
  const w = sourceW * scale;
  const h = sourceH * scale;
  return { x: (destW - w) / 2, y: (destH - h) / 2, w, h };
}

export function objectFitContainRect(
  boxW: number,
  boxH: number,
  contentW: number,
  contentH: number,
): { x: number; y: number; w: number; h: number } {
  if (!boxW || !boxH || !contentW || !contentH) {
    return { x: 0, y: 0, w: boxW, h: boxH };
  }
  return fitContain(contentW, contentH, boxW, boxH);
}
