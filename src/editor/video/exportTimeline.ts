import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import { filenameFor } from "../../browser";
import type { EditorClip, ExportResult } from "../../types";
import { fitContain } from "../../utils";
import { clipGain, envelopeAt } from "../shared/audioGain";
import { rasterizeClip } from "../shared/probe";

export type ExportClip = {
  file: Blob;
  inMs: number;
  outMs: number;
  volume?: number;
  muted?: boolean;
  fadeInMs?: number;
  fadeOutMs?: number;
  kind?: "video" | "audio";
  startMs?: number;
};

type AudioStem = {
  timelineStartMs: number;
  clip: EditorClip;
  buffer: AudioBuffer;
};

export async function exportTimeline(options: {
  clips: ExportClip[];
  width: number;
  height: number;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { clips, width, height, onProgress, signal } = options;
  const picture = clips.filter((clip) => clip.kind !== "audio");
  const extras = clips.filter((clip) => clip.kind === "audio");
  if (!picture.length) throw new Error("Add at least one clip before exporting.");

  const quality = new Quality("high");
  const mp4 = new Mp4OutputFormat();
  let videoCodec = await getFirstEncodableVideoCodec(mp4.getSupportedVideoCodecs(), {
    width,
    height,
    quality,
  });
  let audioCodec = await getFirstEncodableAudioCodec(mp4.getSupportedAudioCodecs(), { quality });
  let format = mp4 as Mp4OutputFormat | WebMOutputFormat;

  if (!videoCodec) {
    const webm = new WebMOutputFormat();
    videoCodec = await getFirstEncodableVideoCodec(webm.getSupportedVideoCodecs(), {
      width,
      height,
      quality,
    });
    audioCodec = await getFirstEncodableAudioCodec(webm.getSupportedAudioCodecs(), { quality });
    format = webm;
  }

  if (!videoCodec) {
    throw new Error("This browser cannot encode video. Export needs WebCodecs (Chrome, Firefox, or Safari 16.4+).");
  }

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create an export canvas.");

  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    quality,
    sizeChangeBehavior: "contain",
  });
  output.addVideoTrack(videoSource, { frameRate: 30 });

  const audioSource = audioCodec
    ? new AudioBufferSource({ codec: audioCodec, quality })
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const pictureMs = picture.reduce((sum, clip) => sum + clipLengthMs(clip), 0);
  const extraEndMs = extras.reduce(
    (max, clip) => Math.max(max, Math.max(0, clip.startMs ?? 0) + clipLengthMs(clip)),
    0,
  );
  const totalMs = Math.max(pictureMs, extraEndMs);
  let outputTime = 0;
  const inputs: Input[] = [];

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };

  try {
    await output.start();

    for (const clip of picture) {
      throwIfAborted();
      const start = clip.inMs / 1000;
      const end = Math.max(start + 0.05, clip.outMs / 1000);
      const clipDuration = end - start;
      let videoWritten = 0;

      const decoded = await decodeClip(clip.file);

      if (decoded) {
        inputs.push(decoded.input);
        if (decoded.videoTrack && (await decoded.videoTrack.canDecode())) {
          const sink = new VideoSampleSink(decoded.videoTrack);
          for await (const sample of sink.samples(start, end)) {
            throwIfAborted();
            ctx.fillStyle = "#000";
            ctx.fillRect(0, 0, width, height);
            const fitted = fitContain(sample.displayWidth, sample.displayHeight, width, height);
            sample.draw(ctx, fitted.x, fitted.y, fitted.w, fitted.h);
            const duration = sample.duration > 0 ? sample.duration : 1 / 30;
            await videoSource.add(outputTime + videoWritten, duration);
            videoWritten += duration;
            sample.close();
            onProgress?.(Math.min(0.8, (outputTime + videoWritten) / Math.max(totalMs / 1000, 0.001)));
          }
        }
      }

      if (videoWritten < 1 / 30) {
        const rasterized = await rasterizeClip(clip.file, start, end, async (video) => {
          throwIfAborted();
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, width, height);
          const fitted = fitContain(video.videoWidth || width, video.videoHeight || height, width, height);
          ctx.drawImage(video, fitted.x, fitted.y, fitted.w, fitted.h);
          await videoSource.add(outputTime + videoWritten, 1 / 30);
          videoWritten += 1 / 30;
          onProgress?.(Math.min(0.8, (outputTime + videoWritten) / Math.max(totalMs / 1000, 0.001)));
        });
        videoWritten = Math.max(videoWritten, rasterized);
      }

      if (videoWritten < 1 / 30) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        await videoSource.add(outputTime, clipDuration);
        videoWritten = clipDuration;
      }

      outputTime += Math.max(videoWritten, clipDuration);
    }

    if (outputTime + 0.02 < totalMs / 1000) {
      const pad = totalMs / 1000 - outputTime;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      await videoSource.add(outputTime, pad);
      outputTime += pad;
    }

    if (audioSource) {
      await writeMixedAudio({
        audioSource,
        picture,
        extras,
        durationSec: outputTime,
        inputs,
        throwIfAborted,
      });
    }

    videoSource.close();
    audioSource?.close();
    await output.finalize();
    onProgress?.(1);

    const buffer = target.buffer;
    if (!buffer) throw new Error("Export finished without producing a file.");
    const mimeType = format.mimeType;
    const blob = new Blob([buffer], { type: mimeType });
    return {
      blob,
      mimeType,
      filename: filenameFor("edit", mimeType),
      durationMs: outputTime * 1000,
      width,
      height,
    };
  } catch (error) {
    if (output.state === "started" || output.state === "finalizing") {
      await output.cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    inputs.forEach((input) => input.dispose());
  }
}

async function writeMixedAudio(options: {
  audioSource: AudioBufferSource;
  picture: ExportClip[];
  extras: ExportClip[];
  durationSec: number;
  inputs: Input[];
  throwIfAborted: () => void;
}): Promise<void> {
  const { audioSource, picture, extras, durationSec, inputs, throwIfAborted } = options;
  const stems: AudioStem[] = [];
  let timelineMs = 0;
  for (const clip of picture) {
    throwIfAborted();
    if (clipGain(clip) > 0) {
      const buffer = await decodeClipAudio(clip.file, clip.inMs, clip.outMs, inputs);
      if (buffer) stems.push({ timelineStartMs: timelineMs, clip: asClip(clip), buffer });
    }
    timelineMs += clipLengthMs(clip);
  }
  for (const clip of extras) {
    throwIfAborted();
    if (clipGain(clip) <= 0) continue;
    const buffer = await decodeClipAudio(clip.file, clip.inMs, clip.outMs, inputs);
    if (buffer) {
      stems.push({
        timelineStartMs: Math.max(0, clip.startMs ?? 0),
        clip: asClip(clip),
        buffer,
      });
    }
  }

  const chunkSec = 0.5;
  for (let t = 0; t < durationSec; t += chunkSec) {
    throwIfAborted();
    const dur = Math.min(chunkSec, durationSec - t);
    const mixed = silentBuffer(dur);
    const startMs = t * 1000;
    for (const stem of stems) {
      mixStem(mixed, startMs, stem);
    }
    await audioSource.add(mixed);
  }
}

async function decodeClipAudio(
  file: Blob,
  inMs: number,
  outMs: number,
  inputs: Input[],
): Promise<AudioBuffer | null> {
  const decoded = await decodeClip(file);
  if (!decoded) return null;
  inputs.push(decoded.input);
  if (!decoded.audioTrack || !(await decoded.audioTrack.canDecode())) return null;
  const start = inMs / 1000;
  const end = Math.max(start + 0.05, outMs / 1000);
  const sink = new AudioBufferSink(decoded.audioTrack);
  const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
  for await (const chunk of sink.buffers(start, end)) {
    chunks.push({ buffer: chunk.buffer, timestamp: chunk.timestamp });
  }
  if (!chunks[0]) return null;
  const sampleRate = chunks[0].buffer.sampleRate;
  const channels = chunks[0].buffer.numberOfChannels;
  const length = Math.max(1, Math.round((end - start) * sampleRate));
  const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
  for (const chunk of chunks) {
    copyBuffer(out, chunk.buffer, Math.round((chunk.timestamp - start) * sampleRate));
  }
  return out;
}

function mixStem(dest: AudioBuffer, destStartMs: number, stem: AudioStem): void {
  const destRate = dest.sampleRate;
  const src = stem.buffer;
  const srcRate = src.sampleRate;
  const clipDur = Math.max(0, stem.clip.outMs - stem.clip.inMs);
  const destEndMs = destStartMs + (dest.length / destRate) * 1000;
  const stemEndMs = stem.timelineStartMs + clipDur;
  if (stemEndMs <= destStartMs || stem.timelineStartMs >= destEndMs) return;

  for (let i = 0; i < dest.length; i += 1) {
    const tMs = destStartMs + (i / destRate) * 1000;
    const localMs = tMs - stem.timelineStartMs;
    if (localMs < 0 || localMs >= clipDur) continue;
    const gain = envelopeAt(stem.clip, localMs);
    if (gain === 0) continue;
    const srcIndex = (localMs / 1000) * srcRate;
    const i0 = Math.floor(srcIndex);
    if (i0 < 0 || i0 >= src.length) continue;
    const frac = srcIndex - i0;
    for (let ch = 0; ch < dest.numberOfChannels; ch += 1) {
      const srcCh = Math.min(ch, src.numberOfChannels - 1);
      const channel = src.getChannelData(srcCh);
      const s0 = channel[i0] ?? 0;
      const s1 = channel[i0 + 1] ?? s0;
      const dst = dest.getChannelData(ch);
      dst[i] = clampSample((dst[i] ?? 0) + (s0 + (s1 - s0) * frac) * gain);
    }
  }
}

function copyBuffer(dest: AudioBuffer, src: AudioBuffer, offset: number): void {
  const destStart = Math.max(0, offset);
  const srcStart = offset < 0 ? -offset : 0;
  const count = Math.min(src.length - srcStart, dest.length - destStart);
  if (count <= 0) return;
  const channels = Math.min(dest.numberOfChannels, src.numberOfChannels);
  for (let ch = 0; ch < channels; ch += 1) {
    dest.getChannelData(ch).set(src.getChannelData(ch).subarray(srcStart, srcStart + count), destStart);
  }
}

function asClip(clip: ExportClip): EditorClip {
  return {
    id: "export",
    sourceId: "export",
    inMs: clip.inMs,
    outMs: clip.outMs,
    volume: clip.volume,
    muted: clip.muted,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
  };
}

function clipLengthMs(clip: ExportClip): number {
  return Math.max(0, clip.outMs - clip.inMs);
}

function clampSample(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function silentBuffer(durationSec: number, sampleRate = 48000, channels = 2): AudioBuffer {
  const length = Math.max(1, Math.round(Math.max(durationSec, 0) * sampleRate));
  return new AudioBuffer({ length, numberOfChannels: channels, sampleRate });
}

async function decodeClip(file: Blob) {
  let input: Input | null = null;
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const videoTrack = await input.getPrimaryVideoTrack();
    const audioTrack = await input.getPrimaryAudioTrack();
    return { input, videoTrack, audioTrack };
  } catch {
    input?.dispose();
    return null;
  }
}
