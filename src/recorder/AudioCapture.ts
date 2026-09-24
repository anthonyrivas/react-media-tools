import { filenameFor, pickAudioMimeType } from "../browser";
import type { AudioRecordingResult, RecorderStatus } from "../types";
import { stopStream } from "../utils";
import { requestMicrophone } from "./composerCapture";
import {
  appendRecorderChunk,
  collectRecorderBlob,
  createSerialQueue,
  pauseMediaRecorder,
  recordingDurationMs,
  resumeMediaRecorder,
  startChunkRecorder,
  startStatusTick,
} from "./recorderSession";

export type AudioCaptureCapabilities = {
  microphone: boolean;
  mediaRecorder: boolean;
  mimeType: string;
  notes: { microphone?: string; recording?: string };
};

export type AudioCaptureSnapshot = {
  status: RecorderStatus;
  error: string | null;
  durationMs: number;
  hasRecording: boolean;
  capabilities: AudioCaptureCapabilities;
};

type Listener = (snapshot: AudioCaptureSnapshot) => void;

const AUDIO_BITRATE = 128_000;

export function waveformColumnCount(width: number, dpr: number): { step: number; gap: number; columns: number } {
  const step = Math.max(dpr, Math.round(dpr * 2));
  const gap = Math.max(1, Math.round(dpr * 0.75));
  return { step, gap, columns: Math.max(1, Math.floor(width / (step + gap))) };
}

export function waveformBarIndex(historyIndex: number, visible: number, bar: number, length: number): number {
  return (historyIndex - visible + bar + length * 4) % length;
}

function detectAudioCapabilities(): AudioCaptureCapabilities {
  const microphone =
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
  const mediaRecorder = typeof MediaRecorder !== "undefined";
  const mimeType = pickAudioMimeType();
  const notes: AudioCaptureCapabilities["notes"] = {};
  if (!microphone) {
    notes.microphone = "Microphone capture is not available in this browser.";
  }
  if (!mediaRecorder || !mimeType) {
    notes.recording = "In-browser audio recording is not supported in this browser.";
  }
  return { microphone, mediaRecorder, mimeType, notes };
}

export class AudioCapture {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly listeners = new Set<Listener>();

  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private timeDomain: Uint8Array<ArrayBuffer> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  private raf = 0;
  private stopTick: (() => void) | null = null;
  private queue = createSerialQueue();
  private destroyed = false;

  private status: RecorderStatus = "idle";
  private error: string | null = null;
  private startedAt = 0;
  private pausedMs = 0;
  private pausedAt = 0;
  lastRecording: AudioRecordingResult | null = null;
  private history = new Float32Array(64);
  private historyIndex = 0;
  private historyFilled = 0;
  private capabilities = detectAudioCapabilities();

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("A 2D canvas context is required for the audio recorder.");
    this.canvas = canvas;
    this.ctx = ctx;
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): AudioCaptureSnapshot {
    return {
      status: this.status,
      error: this.error,
      durationMs: this.currentDuration(),
      hasRecording: Boolean(this.lastRecording),
      capabilities: this.capabilities,
    };
  }

  async startRecording(): Promise<void> {
    await this.queue.enqueue(async () => {
      if (this.status === "recording") return;
      if (this.status === "paused" && this.recorder) {
        this.resumeRecording();
        return;
      }
      this.capabilities = detectAudioCapabilities();
      if (!this.capabilities.microphone) {
        throw new Error(this.capabilities.notes.microphone ?? "Microphone is not available.");
      }
      if (!this.capabilities.mediaRecorder || !this.capabilities.mimeType) {
        throw new Error(this.capabilities.notes.recording ?? "Audio recording is not supported in this browser.");
      }

      this.error = null;
      try {
        const stream = await requestMicrophone();
        if (this.destroyed) {
          stopStream(stream);
          return;
        }

        this.releaseMic();
        this.stream = stream;
        stream.getAudioTracks()[0]?.addEventListener("ended", () => {
          if (this.status === "recording" || this.status === "paused") {
            void this.stopRecording();
          } else {
            this.releaseMic();
            this.status = "idle";
            this.emit();
          }
        });

        this.connectAnalyser(stream);
        await this.audioCtx?.resume();

        const mimeType = this.capabilities.mimeType;
        this.chunks = [];
        this.history.fill(0);
        this.historyIndex = 0;
        this.historyFilled = 0;
        this.recorder = startChunkRecorder(
          stream,
          { mimeType, audioBitsPerSecond: AUDIO_BITRATE },
          this.onData,
        );
        this.startedAt = performance.now();
        this.pausedMs = 0;
        this.pausedAt = 0;
        this.status = "recording";
        this.beginTick();
        this.emit();
      } catch (error) {
        this.releaseMic();
        this.status = "idle";
        this.error = error instanceof Error ? error.message : "Could not start audio recording.";
        this.emit();
        throw error;
      }
    });
  }

  pauseRecording(): void {
    const pausedAt = pauseMediaRecorder(this.recorder, this.status);
    if (pausedAt == null) return;
    this.pausedAt = pausedAt;
    this.status = "paused";
    this.emit();
  }

  resumeRecording(): void {
    const next = resumeMediaRecorder(this.recorder, this.status, this.pausedAt, this.pausedMs);
    if (!next) return;
    this.pausedMs = next.pausedMs;
    this.pausedAt = 0;
    this.status = "recording";
    this.emit();
  }

  async stopRecording(): Promise<AudioRecordingResult | null> {
    return this.queue.enqueue(async () => {
      const recorder = this.recorder;
      if (!recorder || (this.status !== "recording" && this.status !== "paused")) {
        return this.lastRecording;
      }
      const collected = await collectRecorderBlob(recorder, this.chunks, pickAudioMimeType() || "audio/webm");
      const result: AudioRecordingResult = {
        blob: collected.blob,
        mimeType: collected.mimeType,
        filename: filenameFor("audio", collected.mimeType),
        durationMs: this.currentDuration(),
      };

      recorder.removeEventListener("dataavailable", this.onData);
      this.recorder = null;
      this.lastRecording = result;
      this.endTick();
      this.releaseMic();
      this.status = "idle";
      this.emit();
      return result;
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.endTick();
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.releaseMic();
    this.listeners.clear();
  }

  private onData = (event: BlobEvent): void => {
    appendRecorderChunk(this.chunks, event);
  };

  private connectAnalyser(stream: MediaStream): void {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.audioCtx = new Ctor();
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.7;
    this.timeDomain = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.source.connect(this.analyser);
  }

  private releaseMic(): void {
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    this.timeDomain = null;
    stopStream(this.stream);
    this.stream = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
  }

  private currentDuration(): number {
    return recordingDurationMs({
      status: this.status,
      startedAt: this.startedAt,
      pausedAt: this.pausedAt,
      pausedMs: this.pausedMs,
      lastDurationMs: this.lastRecording?.durationMs,
    });
  }

  private beginTick(): void {
    this.endTick();
    this.stopTick = startStatusTick(() => this.emit());
  }

  private endTick(): void {
    this.stopTick?.();
    this.stopTick = null;
  }

  private loop(): void {
    if (this.destroyed) return;
    this.ensureHistorySize(this.columnCount());
    this.sampleLevel();
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  private columnCount(): number {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(Math.max(1, this.canvas.clientWidth || 640) * dpr));
    return waveformColumnCount(width, dpr).columns;
  }

  private ensureHistorySize(columns: number): void {
    const needed = Math.max(1, columns);
    if (this.history.length >= needed) return;
    const next = new Float32Array(needed);
    const filled = this.historyFilled;
    const length = this.history.length;
    for (let i = 0; i < filled; i += 1) {
      next[i] = this.history[waveformBarIndex(this.historyIndex, filled, i, length)] ?? 0;
    }
    this.history = next;
    this.historyIndex = filled;
    this.historyFilled = filled;
  }

  private sampleLevel(): void {
    if (this.status !== "recording" || !this.analyser || !this.timeDomain) return;
    this.analyser.getByteTimeDomainData(this.timeDomain);
    let sum = 0;
    for (let i = 0; i < this.timeDomain.length; i += 1) {
      const sample = ((this.timeDomain[i] ?? 128) - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / Math.max(1, this.timeDomain.length));
    const length = this.history.length;
    this.history[this.historyIndex] = Math.min(1, rms * 3.2);
    this.historyIndex = (this.historyIndex + 1) % length;
    this.historyFilled = Math.min(length, this.historyFilled + 1);
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(Math.max(1, canvas.clientWidth || 640) * dpr));
    const height = Math.max(1, Math.round(Math.max(1, canvas.clientHeight || 160) * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    ctx.fillStyle = "#090a0e";
    ctx.fillRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const fill =
      styles.getPropertyValue("--rmt-accent").trim() ||
      styles.getPropertyValue("--rmt-fg").trim() ||
      "#e2a15a";
    const muted = styles.getPropertyValue("--rmt-on-stage-muted").trim() || "rgba(243, 241, 235, 0.28)";
    const mid = height / 2;
    ctx.fillStyle = muted;
    ctx.fillRect(0, mid - dpr, width, dpr);

    if (this.historyFilled === 0) return;

    const { step, gap, columns } = waveformColumnCount(width, dpr);
    this.ensureHistorySize(columns);
    const visible = Math.min(this.historyFilled, columns);
    const length = this.history.length;
    const maxBar = height * 0.78;
    ctx.fillStyle = fill;

    for (let bar = 0; bar < visible; bar += 1) {
      const amp = this.history[waveformBarIndex(this.historyIndex, visible, bar, length)] ?? 0;
      if (amp < 0.02) continue;
      const x = bar * (step + gap);
      const heightBar = Math.max(dpr * 3, amp * maxBar);
      const y = mid - heightBar / 2;
      const radius = Math.min(step / 2, heightBar / 2);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, step, heightBar, radius);
      else ctx.rect(x, y, step, heightBar);
      ctx.fill();
    }
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
