import {
  detectCapabilities,
  pickMimeType,
  suggestedBitrate,
  filenameFor,
} from "../browser";
import type {
  BrowserCapabilities,
  CameraOverlay,
  RecorderStatus,
  RecordingResult,
  SourceName,
} from "../types";
import { stopStream } from "../utils";
import { clampOverlay, defaultOverlay } from "./overlay";
import { paintComposerFrame } from "./composerDraw";
import { pumpTrackFrames, startBackgroundDrawClock, type PaintFrame } from "./trackFrames";
import {
  closeAudioGraph,
  connectMicrophone,
  connectSystemAudio,
  disconnectMicrophone,
  disconnectSystemSource,
  emptyAudioGraph,
  ensureAudioGraph,
} from "./composerAudio";
import {
  hintMotion,
  mixCaptureStream,
  onTrackEnded,
  requestCamera,
  requestDisplay,
  requestMicrophone,
} from "./composerCapture";
import {
  DEFAULT_CANVAS,
  createHiddenVideo,
  keepPlaying,
  liveVideoImage,
  mountSourceVideo,
  playVideo,
  sourceCanvasSize,
  stopVideoFrameWatch,
  watchVideoFrames,
  type VideoFrameIds,
} from "./composerVideo";
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

export type ComposerSnapshot = {
  status: RecorderStatus;
  camera: boolean;
  screen: boolean;
  microphone: boolean;
  systemAudio: boolean;
  systemAudioTrack: boolean;
  error: string | null;
  durationMs: number;
  canvasWidth: number;
  canvasHeight: number;
  overlay: CameraOverlay;
  cameraAspect: number;
  capabilities: BrowserCapabilities;
  sizeLocked: boolean;
  hasRecording: boolean;
};

type Listener = (snapshot: ComposerSnapshot) => void;

export class MediaComposer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cameraVideo = createHiddenVideo();
  private readonly screenVideo = createHiddenVideo();
  private readonly listeners = new Set<Listener>();
  private readonly queue = createSerialQueue();
  private readonly audio = emptyAudioGraph();
  private readonly frameIds: VideoFrameIds = { camera: 0, screen: 0 };

  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private captureStream: MediaStream | null = null;

  private raf = 0;
  private stopTick: (() => void) | null = null;
  private stopCameraPump: (() => void) | null = null;
  private stopScreenPump: (() => void) | null = null;
  private stopDrawClock: (() => void) | null = null;
  private latestCameraFrame: PaintFrame | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedMs = 0;
  private destroyed = false;

  camera = false;
  screen = false;
  microphone = false;
  systemAudio = false;
  systemAudioTrack = false;
  status: RecorderStatus = "idle";
  error: string | null = null;
  overlay: CameraOverlay = { x: 0.74, y: 0.7, width: 0.22 };
  cameraAspect = 16 / 9;
  capabilities = detectCapabilities();
  sizeLocked = false;
  lastRecording: RecordingResult | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Could not create a 2D canvas context.");
    this.canvas = canvas;
    this.ctx = ctx;
    this.canvas.width = DEFAULT_CANVAS.width;
    this.canvas.height = DEFAULT_CANVAS.height;
    this.loop = this.loop.bind(this);
    mountSourceVideo(this.canvas, this.cameraVideo);
    mountSourceVideo(this.canvas, this.screenVideo);
    this.cameraVideo.addEventListener("pause", this.onCameraPause);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.raf = requestAnimationFrame(this.loop);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ComposerSnapshot {
    return {
      status: this.status,
      camera: this.camera,
      screen: this.screen,
      microphone: this.microphone,
      systemAudio: this.systemAudio,
      systemAudioTrack: this.systemAudioTrack,
      error: this.error,
      durationMs: this.currentDuration(),
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      overlay: this.overlay,
      cameraAspect: this.cameraAspect,
      capabilities: this.capabilities,
      sizeLocked: this.sizeLocked,
      hasRecording: !!this.lastRecording,
    };
  }

  setOverlay(overlay: CameraOverlay): void {
    this.overlay = clampOverlay(overlay, this.canvas.width, this.canvas.height, this.cameraAspect);
    this.emit();
  }

  setSource(name: SourceName, enabled: boolean): Promise<void> {
    return this.queue.enqueue(async () => {
      this.error = null;
      try {
        if (name === "camera") await this.setCamera(enabled);
        if (name === "screen") await this.setScreen(enabled);
        if (name === "microphone") await this.setMicrophone(enabled);
        if (name === "systemAudio") await this.setSystemAudio(enabled);
        this.refreshStatus();
      } catch (error) {
        this.error = error instanceof Error ? error.message : "Could not change source.";
        throw error;
      } finally {
        this.emit();
      }
    });
  }

  async startRecording(): Promise<void> {
    await this.queue.enqueue(async () => {
      if (this.status === "recording") return;
      if (this.status === "paused" && this.recorder) {
        this.resumeRecording();
        return;
      }
      if (!this.capabilities.mediaRecorder || !this.capabilities.canvasCapture) {
        throw new Error("Recording is not supported in this browser.");
      }
      if (!this.camera && !this.screen) await this.setCamera(true);
      this.error = null;
      this.updateCanvasSize();
      this.sizeLocked = true;

      const hasAudio = this.microphone || (this.systemAudio && this.systemAudioTrack);
      if (hasAudio) {
        ensureAudioGraph(this.audio);
        await this.audio.audioCtx?.resume();
      }

      const mimeType = pickMimeType({ audio: hasAudio }) || pickMimeType();
      this.captureStream = this.canvas.captureStream(30);
      hintMotion(this.captureStream);
      this.chunks = [];
      this.recorder = startChunkRecorder(
        mixCaptureStream(this.captureStream, this.audio.audioDest, hasAudio),
        { mimeType, videoBitsPerSecond: suggestedBitrate(this.canvas.width, this.canvas.height) },
        this.onData,
      );
      this.startedAt = performance.now();
      this.pausedMs = 0;
      this.pausedAt = 0;
      this.status = "recording";
      this.restartTrackPumps();
      this.ensureBackgroundClock();
      this.beginTick();
      this.emit();
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

  async stopRecording(): Promise<RecordingResult | null> {
    return this.queue.enqueue(async () => {
      const recorder = this.recorder;
      if (!recorder || (this.status !== "recording" && this.status !== "paused")) {
        return this.lastRecording;
      }
      const collected = await collectRecorderBlob(
        recorder,
        this.chunks,
        pickMimeType({ audio: this.microphone || this.systemAudioTrack }) || "video/webm",
      );
      const result: RecordingResult = {
        blob: collected.blob,
        mimeType: collected.mimeType,
        filename: filenameFor("recording", collected.mimeType),
        durationMs: this.currentDuration(),
        width: this.canvas.width,
        height: this.canvas.height,
      };

      recorder.removeEventListener("dataavailable", this.onData);
      this.recorder = null;
      this.captureStream?.getTracks().forEach((track) => track.stop());
      this.captureStream = null;
      this.sizeLocked = false;
      this.lastRecording = result;
      this.stopBackgroundClock();
      this.endTick();
      if (this.camera) await this.setCamera(false);
      if (this.screen) await this.setScreen(false);
      this.status = this.camera || this.screen ? "preview" : "idle";
      this.updateCanvasSize();
      this.emit();
      return result;
    });
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stopTrackPumps();
    this.stopBackgroundClock();
    stopVideoFrameWatch(this.cameraVideo, "camera", this.frameIds);
    stopVideoFrameWatch(this.screenVideo, "screen", this.frameIds);
    this.cameraVideo.removeEventListener("pause", this.onCameraPause);
    this.cameraVideo.remove();
    this.screenVideo.remove();
    this.endTick();
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    stopStream(this.cameraStream);
    stopStream(this.screenStream);
    stopStream(this.micStream);
    stopStream(this.captureStream);
    this.cameraStream = null;
    this.screenStream = null;
    this.micStream = null;
    closeAudioGraph(this.audio);
    this.listeners.clear();
  }

  private onData = (event: BlobEvent): void => {
    appendRecorderChunk(this.chunks, event);
  };

  private async setCamera(enabled: boolean): Promise<void> {
    if (enabled === this.camera && !!this.cameraStream === enabled) return;
    if (!enabled) {
      stopStream(this.cameraStream);
      this.cameraStream = null;
      stopVideoFrameWatch(this.cameraVideo, "camera", this.frameIds);
      this.cameraVideo.srcObject = null;
      this.camera = false;
      this.restartTrackPumps();
      this.updateCanvasSize();
      return;
    }
    if (!this.capabilities.camera) {
      throw new Error(this.capabilities.notes.camera ?? "Camera is not available.");
    }
    const stream = await requestCamera();
    this.cameraStream = stream;
    mountSourceVideo(this.canvas, this.cameraVideo);
    this.cameraVideo.srcObject = stream;
    await playVideo(this.cameraVideo);
    this.watch("camera");
    if (this.cameraVideo.videoWidth && this.cameraVideo.videoHeight) {
      this.cameraAspect = this.cameraVideo.videoWidth / this.cameraVideo.videoHeight;
    }
    this.overlay = defaultOverlay(this.canvas.width, this.canvas.height, this.cameraAspect);
    onTrackEnded(stream, "video", () => {
      void this.setSource("camera", false);
    });
    this.camera = true;
    this.restartTrackPumps();
    this.updateCanvasSize();
  }

  private async setScreen(enabled: boolean, forceRestart = false): Promise<void> {
    if (!enabled) {
      disconnectSystemSource(this.audio);
      stopStream(this.screenStream);
      this.screenStream = null;
      stopVideoFrameWatch(this.screenVideo, "screen", this.frameIds);
      this.screenVideo.srcObject = null;
      this.screen = false;
      this.systemAudioTrack = false;
      this.restartTrackPumps();
      this.updateCanvasSize();
      return;
    }
    if (this.screen && this.screenStream && !forceRestart) return;
    if (!this.capabilities.screen) {
      throw new Error(this.capabilities.notes.screen ?? "Screen capture is not available.");
    }
    const stream = await requestDisplay(this.systemAudio || this.capabilities.systemAudio);
    disconnectSystemSource(this.audio);
    stopStream(this.screenStream);
    this.screenStream = stream;
    mountSourceVideo(this.canvas, this.screenVideo);
    this.screenVideo.srcObject = stream;
    await playVideo(this.screenVideo);
    this.watch("screen");
    if (this.camera && this.cameraStream) {
      this.cameraStream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      await playVideo(this.cameraVideo);
      this.watch("camera");
    }
    onTrackEnded(stream, "video", () => {
      void this.setSource("screen", false);
    });
    this.screen = true;
    this.restartTrackPumps();
    this.systemAudioTrack = connectSystemAudio(this.audio, stream, this.systemAudio);
    this.updateCanvasSize();
  }

  private async setMicrophone(enabled: boolean): Promise<void> {
    if (!enabled) {
      disconnectMicrophone(this.audio);
      stopStream(this.micStream);
      this.micStream = null;
      this.microphone = false;
      return;
    }
    if (!this.capabilities.microphone) {
      throw new Error(this.capabilities.notes.microphone ?? "Microphone is not available.");
    }
    ensureAudioGraph(this.audio);
    const stream = await requestMicrophone();
    stopStream(this.micStream);
    this.micStream = stream;
    connectMicrophone(this.audio, stream);
    onTrackEnded(stream, "audio", () => {
      void this.setSource("microphone", false);
    });
    this.microphone = true;
  }

  private async setSystemAudio(enabled: boolean): Promise<void> {
    this.systemAudio = enabled;
    if (!enabled) {
      disconnectSystemSource(this.audio);
      return;
    }
    if (!this.screen) await this.setScreen(true);
    if (!this.systemAudioTrack) {
      if (!this.capabilities.systemAudio) {
        this.error = this.capabilities.notes.systemAudio ?? "System audio is not available in this browser.";
        return;
      }
      await this.setScreen(true, true);
    }
    this.systemAudioTrack = connectSystemAudio(this.audio, this.screenStream, true);
    if (!this.systemAudioTrack) {
      this.error =
        "No system audio track was shared. In the browser prompt, enable “Share audio” and try again.";
    }
  }

  private updateCanvasSize(): void {
    if (this.sizeLocked) return;
    const next = sourceCanvasSize({
      screen: this.screen,
      camera: this.camera,
      screenWidth: this.screenVideo.videoWidth,
      screenHeight: this.screenVideo.videoHeight,
      cameraWidth: this.cameraVideo.videoWidth,
      cameraHeight: this.cameraVideo.videoHeight,
    });
    if (this.canvas.width === next.width && this.canvas.height === next.height) return;
    this.canvas.width = next.width;
    this.canvas.height = next.height;
    this.overlay = clampOverlay(this.overlay, next.width, next.height, this.cameraAspect);
  }

  private refreshStatus(): void {
    if (this.status === "recording" || this.status === "paused") return;
    this.status = this.camera || this.screen ? "preview" : "idle";
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

  private onCameraPause = (): void => {
    if (this.destroyed || !this.camera || !this.cameraStream) return;
    keepPlaying(this.cameraVideo, this.destroyed);
  };

  private watch(slot: "camera" | "screen"): void {
    watchVideoFrames(
      slot === "camera" ? this.cameraVideo : this.screenVideo,
      slot,
      this.frameIds,
      () => !this.destroyed,
      () => this.draw(),
    );
  }

  private restartTrackPumps(): void {
    this.stopTrackPumps();
    const cameraTrack = this.cameraStream?.getVideoTracks()[0];
    const screenTrack = this.screenStream?.getVideoTracks()[0];
    if (cameraTrack) {
      this.stopCameraPump = pumpTrackFrames(cameraTrack, (frame) => {
        if (this.destroyed) {
          frame.close();
          return;
        }
        this.latestCameraFrame?.close();
        this.latestCameraFrame = frame;
        this.draw();
      });
    }
    if (screenTrack) {
      this.stopScreenPump = pumpTrackFrames(screenTrack, (frame) => {
        if (this.destroyed) {
          frame.close();
          return;
        }
        this.draw(frame);
        frame.close();
      });
    }
  }

  private stopTrackPumps(): void {
    this.stopCameraPump?.();
    this.stopScreenPump?.();
    this.stopCameraPump = null;
    this.stopScreenPump = null;
    this.latestCameraFrame?.close();
    this.latestCameraFrame = null;
  }

  private ensureBackgroundClock(): void {
    if (this.stopDrawClock || this.destroyed) return;
    this.stopDrawClock = startBackgroundDrawClock(() => {
      if (!this.destroyed) this.draw();
    });
  }

  private stopBackgroundClock(): void {
    this.stopDrawClock?.();
    this.stopDrawClock = null;
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      if (this.status === "recording" || (this.camera && this.screen)) this.ensureBackgroundClock();
      return;
    }
    if (this.status !== "recording") this.stopBackgroundClock();
    if (this.camera) keepPlaying(this.cameraVideo, this.destroyed);
    if (this.screen) keepPlaying(this.screenVideo, this.destroyed);
  };

  private loop(): void {
    if (this.destroyed) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  private draw(screenFrame?: PaintFrame | null): void {
    if (this.camera) keepPlaying(this.cameraVideo, this.destroyed);
    if (this.screen) keepPlaying(this.screenVideo, this.destroyed);
    paintComposerFrame(this.ctx, this.canvas, {
      screen: this.screen,
      screenSource: screenFrame ?? liveVideoImage(this.screen, this.screenVideo),
      cameraSource: this.latestCameraFrame ?? liveVideoImage(this.camera, this.cameraVideo),
      overlay: this.overlay,
      cameraAspect: this.cameraAspect,
    });
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
