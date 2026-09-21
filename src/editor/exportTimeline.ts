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
import { filenameFor } from "../browser";
import type { ExportResult } from "../types";
import { fitContain } from "../utils";
import { rasterizeClip } from "./probe";

export type ExportClip = {
  file: Blob;
  inMs: number;
  outMs: number;
};

export async function exportTimeline(options: {
  clips: ExportClip[];
  width: number;
  height: number;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { clips, width, height, onProgress, signal } = options;
  if (!clips.length) throw new Error("Add at least one clip before exporting.");

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

  const totalMs = clips.reduce((sum, clip) => sum + Math.max(0, clip.outMs - clip.inMs), 0);
  let outputTime = 0;
  const inputs: Input[] = [];

  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };

  try {
    await output.start();

    for (const clip of clips) {
      throwIfAborted();
      const start = clip.inMs / 1000;
      const end = Math.max(start + 0.05, clip.outMs / 1000);
      const clipDuration = end - start;
      let videoWritten = 0;
      let audioWritten = 0;

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
            onProgress?.(Math.min(1, (outputTime + videoWritten) / Math.max(totalMs / 1000, 0.001)));
          }
        }

        if (audioSource && decoded.audioTrack && (await decoded.audioTrack.canDecode())) {
          const sink = new AudioBufferSink(decoded.audioTrack);
          for await (const chunk of sink.buffers(start, end)) {
            throwIfAborted();
            await audioSource.add(chunk.buffer);
            audioWritten += chunk.duration;
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
          onProgress?.(Math.min(1, (outputTime + videoWritten) / Math.max(totalMs / 1000, 0.001)));
        });
        videoWritten = Math.max(videoWritten, rasterized);
      }

      if (videoWritten < 1 / 30) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        await videoSource.add(outputTime, clipDuration);
        videoWritten = clipDuration;
      }

      const written = Math.max(videoWritten, clipDuration);
      if (audioSource && audioWritten < written - 0.02) {
        await audioSource.add(silentBuffer(written - audioWritten));
      }

      outputTime += written;
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
