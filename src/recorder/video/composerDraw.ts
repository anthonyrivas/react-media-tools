import type { CameraOverlay } from "../../types";
import { overlayPixels, pathRoundedRect, pipCornerRadius } from "./overlay";

export function paintCameraPip(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const radius = pipCornerRadius(width, height);
  ctx.save();
  pathRoundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.drawImage(source, x, y, width, height);
  ctx.restore();
}

export function paintComposerFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  input: {
    screen: boolean;
    screenSource: CanvasImageSource | null;
    cameraSource: CanvasImageSource | null;
    overlay: CameraOverlay;
    cameraAspect: number;
  },
): void {
  ctx.fillStyle = "#0c0d12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (input.screen && input.screenSource) {
    ctx.drawImage(input.screenSource, 0, 0, canvas.width, canvas.height);
    if (input.cameraSource) {
      const rect = overlayPixels(input.overlay, canvas.width, canvas.height, input.cameraAspect);
      paintCameraPip(ctx, input.cameraSource, rect.x, rect.y, rect.width, rect.height);
    }
    return;
  }

  if (input.cameraSource) {
    ctx.drawImage(input.cameraSource, 0, 0, canvas.width, canvas.height);
  }
}
