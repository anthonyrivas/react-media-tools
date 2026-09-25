import { useCallback, useLayoutEffect, useRef } from "react";
import { clamp } from "../timeline/timelineMath";
import { paintWaveform, type WaveformPeaks } from "../shared/waveform";

export function StageWaveform({
  peaks,
  inMs,
  outMs,
  localMs,
  gain,
}: {
  peaks: WaveformPeaks;
  inMs: number;
  outMs: number;
  localMs: number;
  gain: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paint = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paintWaveform(canvas, peaks, inMs, outMs);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const duration = Math.max(1, outMs - inMs);
    const x = (clamp(localMs, 0, duration) / duration) * canvas.width;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.35 + gain * 0.65);
    ctx.fillStyle = getComputedStyle(canvas).color || "#f3f1eb";
    ctx.fillRect(Math.max(0, x - 1), 0, 2, canvas.height);
    ctx.restore();
  }, [gain, inMs, localMs, outMs, peaks]);

  useLayoutEffect(() => {
    paint();
    const canvas = ref.current;
    if (!canvas) return;
    const resize = new ResizeObserver(paint);
    resize.observe(canvas);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
      subtree: true,
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [paint]);

  return <canvas ref={ref} className="rmt-editor__wave-stage" aria-hidden="true" />;
}
