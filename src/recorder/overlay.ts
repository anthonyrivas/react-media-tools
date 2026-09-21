import type { CameraOverlay } from "../types";

export const MIN_OVERLAY_WIDTH = 0.1;
export const MAX_OVERLAY_WIDTH = 0.7;
/** Light rounding on the camera pip, in CSS pixels of the output canvas. */
export const PIP_RADIUS_PX = 10;

export function pipCornerRadius(width: number, height: number): number {
  return Math.min(PIP_RADIUS_PX, width / 2, height / 2);
}

export function pathRoundedRect(
  ctx: Pick<CanvasRenderingContext2D, "beginPath" | "moveTo" | "arcTo" | "closePath">,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function overlayHeightFrac(
  overlay: CameraOverlay,
  canvasW: number,
  canvasH: number,
  aspect: number,
): number {
  if (!canvasW || !canvasH || !aspect) return overlay.width;
  return (overlay.width * canvasW) / aspect / canvasH;
}

export function overlayPixels(
  overlay: CameraOverlay,
  canvasW: number,
  canvasH: number,
  aspect: number,
): { x: number; y: number; width: number; height: number } {
  const width = overlay.width * canvasW;
  const height = aspect ? width / aspect : overlay.width * canvasH;
  return {
    x: overlay.x * canvasW,
    y: overlay.y * canvasH,
    width,
    height,
  };
}

export function clampOverlay(
  overlay: CameraOverlay,
  canvasW: number,
  canvasH: number,
  aspect: number,
): CameraOverlay {
  const safeAspect = aspect > 0 ? aspect : 16 / 9;
  let width = Math.min(MAX_OVERLAY_WIDTH, Math.max(MIN_OVERLAY_WIDTH, overlay.width));
  let heightPx = (width * canvasW) / safeAspect;
  const maxHeightPx = canvasH * 0.92;
  if (heightPx > maxHeightPx && canvasH > 0) {
    heightPx = maxHeightPx;
    width = (heightPx * safeAspect) / Math.max(canvasW, 1);
  }
  const heightFrac = canvasH > 0 ? heightPx / canvasH : width;
  const x = Math.min(Math.max(overlay.x, 0), Math.max(0, 1 - width));
  const y = Math.min(Math.max(overlay.y, 0), Math.max(0, 1 - heightFrac));
  return { x, y, width };
}

export function defaultOverlay(
  canvasW: number,
  canvasH: number,
  aspect: number,
): CameraOverlay {
  const width = 0.22;
  const heightFrac = overlayHeightFrac({ x: 0, y: 0, width }, canvasW, canvasH, aspect);
  const margin = 0.035;
  return clampOverlay(
    { x: 1 - width - margin, y: 1 - heightFrac - margin, width },
    canvasW,
    canvasH,
    aspect,
  );
}
