import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";

/** Compact peak envelope for one source. Bins are evenly spaced across `durationMs`. */
export type WaveformPeaks = {
  durationMs: number;
  peaks: Float32Array;
};

const BINS_PER_SEC = 80;

export async function extractPeaks(file: Blob): Promise<WaveformPeaks | null> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  });
  try {
    const audio = await input.getPrimaryAudioTrack();
    if (!audio || !(await audio.canDecode())) return null;
    const duration = await audio.computeDuration();
    if (!(duration > 0)) return null;

    const count = Math.max(1, Math.ceil(duration * BINS_PER_SEC));
    const peaks = new Float32Array(count);
    const sink = new AudioBufferSink(audio);

    for await (const chunk of sink.buffers()) {
      const buffer = chunk.buffer;
      const channels = buffer.numberOfChannels;
      const frames = buffer.length;
      const sampleRate = buffer.sampleRate;
      if (!frames || !sampleRate) continue;
      const step = Math.max(1, Math.floor(sampleRate / (BINS_PER_SEC * 6)));
      const channelData: Float32Array[] = [];
      for (let channel = 0; channel < channels; channel += 1) {
        channelData.push(buffer.getChannelData(channel));
      }
      for (let frame = 0; frame < frames; frame += step) {
        let mix = 0;
        for (let channel = 0; channel < channels; channel += 1) {
          mix += channelData[channel]?.[frame] ?? 0;
        }
        const bin = Math.min(count - 1, Math.floor((chunk.timestamp + frame / sampleRate) * BINS_PER_SEC));
        const amp = Math.abs(mix / Math.max(1, channels));
        const current = peaks[bin] ?? 0;
        if (amp > current) peaks[bin] = amp;
      }
    }

    let loudest = 0;
    for (let i = 0; i < peaks.length; i += 1) {
      const value = peaks[i] ?? 0;
      if (value > loudest) loudest = value;
    }
    if (loudest > 0.02) {
      const scale = 1 / loudest;
      for (let i = 0; i < peaks.length; i += 1) peaks[i] = (peaks[i] ?? 0) * scale;
    }

    return { durationMs: duration * 1000, peaks };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

export function paintWaveform(
  canvas: HTMLCanvasElement,
  peaks: WaveformPeaks,
  inMs: number,
  outMs: number,
): void {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(Math.max(1, canvas.clientWidth) * dpr));
  const height = Math.max(1, Math.round(Math.max(1, canvas.clientHeight) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx || peaks.peaks.length === 0) return;
  ctx.clearRect(0, 0, width, height);

  const duration = Math.max(1, peaks.durationMs);
  const start = Math.min(peaks.peaks.length, Math.max(0, (inMs / duration) * peaks.peaks.length));
  const end = Math.min(peaks.peaks.length, Math.max(start + 0.001, (outMs / duration) * peaks.peaks.length));
  const span = Math.max(0.001, end - start);
  const mid = height / 2;
  const maxBar = height * 0.84;
  const step = Math.max(dpr, Math.round(dpr * 1.25));
  const gap = Math.max(1, Math.round(dpr * 0.5));
  const host = canvas.closest(".rmt-clip");
  const styles = getComputedStyle(host ?? canvas);
  // Clips sit on the editor chrome (`--rmt-fg`). The preview stage stays dark in
  // both themes, so it must use `--rmt-on-stage` or it vanishes in light mode.
  const fill = host
    ? styles.getPropertyValue("--rmt-fg").trim() || styles.color || "#f3f1eb"
    : styles.getPropertyValue("--rmt-on-stage").trim() || styles.color || "#f3f1eb";
  const tipAlpha = parseAlpha(styles.getPropertyValue("--rmt-wave-tip-alpha"), 0.18);
  const centerAlpha = parseAlpha(styles.getPropertyValue("--rmt-wave-center-alpha"), 0.36);

  const rgb = rgbFromCss(fill);
  const tip = `rgba(${rgb}, ${tipAlpha})`;
  const center = `rgba(${rgb}, ${centerAlpha})`;

  for (let x = 0; x < width; x += step + gap) {
    const from = start + (x / width) * span;
    const to = start + ((x + step) / width) * span;
    const i0 = Math.max(0, Math.floor(from));
    const i1 = Math.min(peaks.peaks.length - 1, Math.ceil(to));
    let amp = 0;
    for (let i = i0; i <= i1; i += 1) {
      const sample = peaks.peaks[i] ?? 0;
      if (sample > amp) amp = sample;
    }
    if (amp < 0.03) continue;
    const bar = Math.max(dpr * 3, amp * maxBar);
    const y = mid - bar / 2;
    const gradient = ctx.createLinearGradient(0, y, 0, y + bar);
    gradient.addColorStop(0, tip);
    gradient.addColorStop(0.5, center);
    gradient.addColorStop(1, tip);
    ctx.fillStyle = gradient;
    fillRoundedBar(ctx, x, y, step, bar, Math.min(step / 2, bar / 2));
  }
}

function parseAlpha(value: string, fallback: number): number {
  const alpha = Number.parseFloat(value);
  return Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : fallback;
}

function rgbFromCss(color: string): string {
  const hex = color.trim();
  if (hex.startsWith("#")) {
    const raw = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7);
    const n = parseInt(raw, 16);
    if (Number.isFinite(n)) {
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    }
  }
  const match = hex.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (match) return `${match[1]}, ${match[2]}, ${match[3]}`;
  return "243, 241, 235";
}

function fillRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  ctx.fill();
}
