import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
} from "mediabunny";
import { filenameFor } from "../../browser";
import type { EditorClip, ExportResult } from "../../types";
import { applyEnvelopeToBuffer, clipGain, clipLengthMs } from "../shared/audioGain";

/** Encoder layout. Mic recordings are often mono; pads and mixed clips must match this. */
export const EXPORT_SAMPLE_RATE = 48000;
export const EXPORT_CHANNELS = 2;

export type AudioExportClip = EditorClip & { file: Blob };

export async function measureClipPeak(file: Blob, inMs: number, outMs: number): Promise<number> {
  const decoded = await decodeAudio(file);
  if (!decoded) return 0;
  try {
    if (!decoded.audioTrack || !(await decoded.audioTrack.canDecode())) return 0;
    const start = inMs / 1000;
    const end = Math.max(start + 0.05, outMs / 1000);
    const sink = new AudioBufferSink(decoded.audioTrack);
    let peak = 0;
    for await (const chunk of sink.buffers(start, end)) {
      peak = Math.max(peak, peakOf(chunk.buffer));
    }
    return peak;
  } catch {
    return 0;
  } finally {
    decoded.input.dispose();
  }
}

export async function exportAudioTimeline(options: {
  clips: AudioExportClip[];
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { clips, onProgress, signal } = options;
  if (!clips.length) throw new Error("Add at least one clip before exporting.");

  const quality = new Quality("high");
  const mp4 = new Mp4OutputFormat();
  let audioCodec = await getFirstEncodableAudioCodec(mp4.getSupportedAudioCodecs(), { quality });
  let format: Mp4OutputFormat | WebMOutputFormat = mp4;

  if (!audioCodec) {
    const webm = new WebMOutputFormat();
    audioCodec = await getFirstEncodableAudioCodec(webm.getSupportedAudioCodecs(), { quality });
    format = webm;
  }

  if (!audioCodec) {
    throw new Error("This browser cannot encode audio. Export needs WebCodecs (Chrome, Firefox, or Safari 16.4+).");
  }

  const target = new BufferTarget();
  const output = new Output({ format, target });
  const audioSource = new AudioBufferSource({ codec: audioCodec, quality });
  output.addAudioTrack(audioSource);

  const totalMs = clips.reduce((sum, clip) => sum + clipLengthMs(clip), 0);
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
      let audioWritten = 0;

      if (clipGain(clip) > 0) {
        const decoded = await decodeAudio(clip.file);
        if (decoded) {
          inputs.push(decoded.input);
          if (decoded.audioTrack && (await decoded.audioTrack.canDecode())) {
            const sink = new AudioBufferSink(decoded.audioTrack);
            for await (const chunk of sink.buffers(start, end)) {
              throwIfAborted();
              const localMs = chunk.timestamp * 1000 - clip.inMs;
              const processed = applyEnvelopeToBuffer(chunk.buffer, clip, localMs);
              await audioSource.add(conformAudioBuffer(processed));
              audioWritten += chunk.duration;
            }
          }
        }
      }

      if (audioWritten < clipDuration - 0.02) {
        await audioSource.add(silentBuffer(clipDuration - audioWritten));
        audioWritten = clipDuration;
      }

      outputTime += Math.max(audioWritten, clipDuration);
      onProgress?.(Math.min(1, outputTime / Math.max(totalMs / 1000, 0.001)));
    }

    audioSource.close();
    await output.finalize();
    onProgress?.(1);

    const buffer = target.buffer;
    if (!buffer) throw new Error("Export finished without producing a file.");
    const mimeType = format.mimeType;
    const blob = new Blob([buffer], { type: mimeType });
    return {
      blob,
      mimeType,
      filename: filenameFor("audio", mimeType),
      durationMs: outputTime * 1000,
      width: 0,
      height: 0,
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

function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const amp = Math.abs(data[i] ?? 0);
      if (amp > peak) peak = amp;
    }
  }
  return peak;
}

function silentBuffer(durationSec: number): AudioBuffer {
  const length = Math.max(1, Math.round(Math.max(durationSec, 0) * EXPORT_SAMPLE_RATE));
  return new AudioBuffer({
    length,
    numberOfChannels: EXPORT_CHANNELS,
    sampleRate: EXPORT_SAMPLE_RATE,
  });
}

/** Copy `src` into stereo 48 kHz so every `AudioBufferSource.add` uses the same layout. */
export function conformAudioBuffer(src: AudioBuffer): AudioBuffer {
  if (src.sampleRate === EXPORT_SAMPLE_RATE && src.numberOfChannels === EXPORT_CHANNELS) return src;
  const duration = src.length / src.sampleRate;
  const length = Math.max(1, Math.round(duration * EXPORT_SAMPLE_RATE));
  const dest = new AudioBuffer({
    length,
    numberOfChannels: EXPORT_CHANNELS,
    sampleRate: EXPORT_SAMPLE_RATE,
  });
  const rateRatio = src.sampleRate / EXPORT_SAMPLE_RATE;
  for (let ch = 0; ch < EXPORT_CHANNELS; ch += 1) {
    const srcData = src.getChannelData(Math.min(ch, src.numberOfChannels - 1));
    const destData = dest.getChannelData(ch);
    if (src.sampleRate === EXPORT_SAMPLE_RATE) {
      destData.set(srcData.subarray(0, Math.min(src.length, length)));
      continue;
    }
    for (let i = 0; i < length; i += 1) {
      const srcIndex = i * rateRatio;
      const i0 = Math.min(src.length - 1, Math.max(0, Math.floor(srcIndex)));
      const i1 = Math.min(src.length - 1, i0 + 1);
      const frac = srcIndex - Math.floor(srcIndex);
      const s0 = srcData[i0] ?? 0;
      const s1 = srcData[i1] ?? s0;
      destData[i] = s0 + (s1 - s0) * frac;
    }
  }
  return dest;
}

async function decodeAudio(file: Blob) {
  let input: Input | null = null;
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    const audioTrack = await input.getPrimaryAudioTrack();
    return { input, audioTrack };
  } catch {
    input?.dispose();
    return null;
  }
}
