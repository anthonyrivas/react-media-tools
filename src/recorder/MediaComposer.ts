import {
  detectCapabilities,
  isSafariLike,
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
import { stopStream, waitForEvent } from "../utils";
import { clampOverlay, defaultOverlay, overlayPixels, pathRoundedRect, pipCornerRadius } from "./overlay";
import { pumpTrackFrames, startBackgroundDrawClock, type PaintFrame } from "./trackFrames";

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

function createHiddenVideo(): HTMLVideoElement {
  const video = document.createElement("video");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.preload = "auto";
  video.disablePictureInPicture = true;
  video.className = "rmt-recorder__source-video";
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("aria-hidden", "true");
  return video;
}

async function playVideo(video: HTMLVideoElement): Promise<void> {
  try {
    await video.play();
  } catch {
    // Autoplay can fail if a track hasn't produced a frame yet; loadeddata retries below.
  }
  if (!video.videoWidth) {
    await waitForEvent(video, "loadeddata", 12000).catch(() => undefined);
  }
}

export class MediaComposer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cameraVideo = createHiddenVideo();
  private readonly screenVideo = createHiddenVideo();
  private readonly listeners = new Set<Listener>();

  private cameraStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;

  private audioCtx: AudioContext | null = null;
  private audioDest: MediaStreamAudioDestinationNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private systemSource: MediaStreamAudioSourceNode | null = null;

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private captureStream: MediaStream | null = null;

  private raf = 0;
  private cameraFrame = 0;
  private screenFrame = 0;
  private tick: number | null = null;
  private stopCameraPump: (() => void) | null = null;
  private stopScreenPump: (() => void) | null = null;
  private stopDrawClock: (() => void) | null = null;
  private latestCameraFrame: PaintFrame | null = null;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedMs = 0;
  private queue: Promise<void> = Promise.resolve();
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
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.loop = this.loop.bind(this);
    this.mountSourceVideo(this.cameraVideo);
    this.mountSourceVideo(this.screenVideo);
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
    this.overlay = clampOverlay(
      overlay,
      this.canvas.width,
      this.canvas.height,
      this.cameraAspect,
    );
    this.emit();
  }

  setSource(name: SourceName, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
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
    await this.enqueue(async () => {
      if (this.status === "recording") return;
      if (this.status === "paused" && this.recorder) {
        this.resumeRecording();
        return;
      }
      if (!this.capabilities.mediaRecorder || !this.capabilities.canvasCapture) {
        throw new Error("Recording is not supported in this browser.");
      }
      if (!this.camera && !this.screen) {
        await this.setCamera(true);
      }
      this.error = null;
      this.updateCanvasSize();
      this.sizeLocked = true;

      const hasAudio = this.microphone || (this.systemAudio && this.systemAudioTrack);
      if (hasAudio) {
        this.ensureAudioGraph();
        await this.audioCtx?.resume();
      }

      const mimeType = pickMimeType({ audio: hasAudio }) || pickMimeType();
      this.captureStream = this.canvas.captureStream(30);
      const videoTrack = this.captureStream.getVideoTracks()[0];
      if (videoTrack && "contentHint" in videoTrack) {
        videoTrack.contentHint = "motion";
      }

      const tracks: MediaStreamTrack[] = [
        ...this.captureStream.getVideoTracks(),
        ...(hasAudio ? (this.audioDest?.stream.getAudioTracks() ?? []) : []),
      ];
      const mixed = new MediaStream(tracks);
      this.chunks = [];
      this.recorder = new MediaRecorder(mixed, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: suggestedBitrate(this.canvas.width, this.canvas.height),
      });
      this.recorder.addEventListener("dataavailable", this.onData);
      if (isSafariLike()) this.recorder.start();
      else this.recorder.start(250);
      this.startedAt = performance.now();
      this.pausedMs = 0;
      this.pausedAt = 0;
      this.status = "recording";
      this.restartTrackPumps();
      this.ensureBackgroundClock();
      this.startTick();
      this.emit();
    });
  }

  pauseRecording(): void {
    if (this.status !== "recording" || !this.recorder) return;
    if (typeof this.recorder.pause !== "function") return;
    if (this.recorder.state === "recording") this.recorder.pause();
    this.pausedAt = performance.now();
    this.status = "paused";
    this.emit();
  }

  resumeRecording(): void {
    if (this.status !== "paused" || !this.recorder) return;
    if (typeof this.recorder.resume === "function" && this.recorder.state === "paused") {
      this.recorder.resume();
    }
    if (this.pausedAt) this.pausedMs += performance.now() - this.pausedAt;
    this.pausedAt = 0;
    this.status = "recording";
    this.emit();
  }

  async stopRecording(): Promise<RecordingResult | null> {
    return this.enqueue(async () => {
      const recorder = this.recorder;
      if (!recorder || (this.status !== "recording" && this.status !== "paused")) {
        return this.lastRecording;
      }
      const result = await new Promise<RecordingResult>((resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => {
            try {
              const mimeType = recorder.mimeType || pickMimeType({ audio: this.microphone || this.systemAudioTrack }) || "video/webm";
              const blob = new Blob(this.chunks, { type: mimeType });
              const durationMs = this.currentDuration();
              resolve({
                blob,
                mimeType,
                filename: filenameFor("recording", mimeType),
                durationMs,
                width: this.canvas.width,
                height: this.canvas.height,
              });
            } catch (error) {
              reject(error);
            }
          },
          { once: true },
        );
        if (recorder.state !== "inactive") recorder.stop();
      });

      recorder.removeEventListener("dataavailable", this.onData);
      this.recorder = null;
      this.captureStream?.getTracks().forEach((track) => track.stop());
      this.captureStream = null;
      this.sizeLocked = false;
      this.lastRecording = result;
      this.stopBackgroundClock();
      this.stopTick();
      if (this.camera) await this.setCamera(false);
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
    this.stopFrameWatch(this.cameraVideo, "camera");
    this.stopFrameWatch(this.screenVideo, "screen");
    this.cameraVideo.removeEventListener("pause", this.onCameraPause);
    this.cameraVideo.remove();
    this.screenVideo.remove();
    this.stopTick();
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    stopStream(this.cameraStream);
    stopStream(this.screenStream);
    stopStream(this.micStream);
    stopStream(this.captureStream);
    this.cameraStream = null;
    this.screenStream = null;
    this.micStream = null;
    this.disconnectAudio();
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.listeners.clear();
  }

  private onData = (event: BlobEvent): void => {
    if (event.data.size > 0) this.chunks.push(event.data);
  };

  private enqueue<T>(work: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(() => work());
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async setCamera(enabled: boolean): Promise<void> {
    if (enabled === this.camera && (!!this.cameraStream === enabled)) return;
    if (!enabled) {
      stopStream(this.cameraStream);
      this.cameraStream = null;
      this.stopFrameWatch(this.cameraVideo, "camera");
      this.cameraVideo.srcObject = null;
      this.camera = false;
      this.restartTrackPumps();
      this.updateCanvasSize();
      return;
    }
    if (!this.capabilities.camera) {
      throw new Error(this.capabilities.notes.camera ?? "Camera is not available.");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: isSafariLike()
        ? { facingMode: "user" }
        : {
            facingMode: "user",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
      audio: false,
    });
    this.cameraStream = stream;
    this.mountSourceVideo(this.cameraVideo);
    this.cameraVideo.srcObject = stream;
    await playVideo(this.cameraVideo);
    this.watchVideoFrames(this.cameraVideo, "camera");
    if (this.cameraVideo.videoWidth && this.cameraVideo.videoHeight) {
      this.cameraAspect = this.cameraVideo.videoWidth / this.cameraVideo.videoHeight;
    }
    this.overlay = defaultOverlay(this.canvas.width, this.canvas.height, this.cameraAspect);
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      void this.setSource("camera", false);
    });
    this.camera = true;
    this.restartTrackPumps();
    this.updateCanvasSize();
  }

  private async setScreen(enabled: boolean, forceRestart = false): Promise<void> {
    if (!enabled) {
      this.disconnectSystemSource();
      stopStream(this.screenStream);
      this.screenStream = null;
      this.stopFrameWatch(this.screenVideo, "screen");
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
    const withAudio = this.systemAudio || this.capabilities.systemAudio;
    const stream = await this.requestDisplay(withAudio);
    this.disconnectSystemSource();
    stopStream(this.screenStream);
    this.screenStream = stream;
    this.mountSourceVideo(this.screenVideo);
    this.screenVideo.srcObject = stream;
    await playVideo(this.screenVideo);
    this.watchVideoFrames(this.screenVideo, "screen");
    if (this.camera && this.cameraStream) {
      this.cameraStream.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
      await playVideo(this.cameraVideo);
      this.watchVideoFrames(this.cameraVideo, "camera");
    }
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      void this.setSource("screen", false);
    });
    this.screen = true;
    this.restartTrackPumps();
    this.systemAudioTrack = stream.getAudioTracks().some((track) => track.readyState === "live");
    if (this.systemAudio) this.connectSystemSource();
    this.updateCanvasSize();
  }

  private async setMicrophone(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.micSource?.disconnect();
      this.micSource = null;
      stopStream(this.micStream);
      this.micStream = null;
      this.microphone = false;
      return;
    }
    if (!this.capabilities.microphone) {
      throw new Error(this.capabilities.notes.microphone ?? "Microphone is not available.");
    }
    this.ensureAudioGraph();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    stopStream(this.micStream);
    this.micSource?.disconnect();
    this.micStream = stream;
    this.micSource = this.audioCtx!.createMediaStreamSource(stream);
    this.micSource.connect(this.audioDest!);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      void this.setSource("microphone", false);
    });
    this.microphone = true;
    await this.audioCtx?.resume();
  }

  private async setSystemAudio(enabled: boolean): Promise<void> {
    this.systemAudio = enabled;
    if (!enabled) {
      this.disconnectSystemSource();
      return;
    }
    if (!this.screen) {
      await this.setScreen(true);
    }
    if (!this.systemAudioTrack) {
      if (!this.capabilities.systemAudio) {
        this.error =
          this.capabilities.notes.systemAudio ??
          "System audio is not available in this browser.";
        return;
      }
      await this.setScreen(true, true);
    }
    this.connectSystemSource();
    if (!this.systemAudioTrack) {
      this.error =
        "No system audio track was shared. In the browser prompt, enable “Share audio” and try again.";
    }
  }

  private async requestDisplay(withAudio: boolean): Promise<MediaStream> {
    const video: boolean | MediaTrackConstraints = isSafariLike()
      ? true
      : {
          frameRate: { ideal: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        };
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video,
        audio: withAudio
          ? {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : false,
      });
    } catch (error) {
      if (withAudio) {
        return navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      }
      throw error;
    }
  }

  private ensureAudioGraph(): void {
    if (this.audioCtx && this.audioDest) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new Ctor();
    this.audioDest = this.audioCtx.createMediaStreamDestination();
  }

  private connectSystemSource(): void {
    this.disconnectSystemSource();
    const tracks = this.screenStream?.getAudioTracks().filter((track) => track.readyState === "live") ?? [];
    this.systemAudioTrack = tracks.length > 0;
    if (!tracks.length || !this.systemAudio) return;
    this.ensureAudioGraph();
    const stream = new MediaStream(tracks);
    this.systemSource = this.audioCtx!.createMediaStreamSource(stream);
    this.systemSource.connect(this.audioDest!);
    void this.audioCtx?.resume();
  }

  private disconnectSystemSource(): void {
    this.systemSource?.disconnect();
    this.systemSource = null;
  }

  private disconnectAudio(): void {
    this.micSource?.disconnect();
    this.disconnectSystemSource();
    this.micSource = null;
    this.audioDest = null;
  }

  private updateCanvasSize(): void {
    if (this.sizeLocked) return;
    let width = 1280;
    let height = 720;
    if (this.screen && this.screenVideo.videoWidth) {
      width = this.screenVideo.videoWidth;
      height = this.screenVideo.videoHeight;
    } else if (this.camera && this.cameraVideo.videoWidth) {
      width = this.cameraVideo.videoWidth;
      height = this.cameraVideo.videoHeight;
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.overlay = clampOverlay(this.overlay, width, height, this.cameraAspect);
    }
  }

  private refreshStatus(): void {
    if (this.status === "recording" || this.status === "paused") return;
    this.status = this.camera || this.screen ? "preview" : "idle";
  }

  private currentDuration(): number {
    if (this.status === "idle" || this.status === "preview" || !this.startedAt) {
      return this.lastRecording?.durationMs ?? 0;
    }
    const pausedPortion =
      this.status === "paused" && this.pausedAt
        ? this.pausedMs + (performance.now() - this.pausedAt)
        : this.pausedMs;
    return Math.max(0, performance.now() - this.startedAt - pausedPortion);
  }

  private startTick(): void {
    this.stopTick();
    this.tick = window.setInterval(() => this.emit(), 100);
  }

  private stopTick(): void {
    if (this.tick != null) {
      window.clearInterval(this.tick);
      this.tick = null;
    }
  }

  private mountSourceVideo(video: HTMLVideoElement): void {
    const host = this.canvas.parentElement ?? document.body;
    if (video.parentElement !== host) host.appendChild(video);
  }

  private onCameraPause = (): void => {
    if (this.destroyed || !this.camera || !this.cameraStream) return;
    this.keepPlaying(this.cameraVideo);
  };

  private keepPlaying(video: HTMLVideoElement): void {
    if (this.destroyed || !video.srcObject) return;
    if (video.paused || video.ended) void video.play().catch(() => undefined);
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
      if (this.status === "recording" || (this.camera && this.screen)) {
        this.ensureBackgroundClock();
      }
      return;
    }
    if (this.status !== "recording") this.stopBackgroundClock();
    if (this.camera) this.keepPlaying(this.cameraVideo);
    if (this.screen) this.keepPlaying(this.screenVideo);
  };

  private cameraImage(): CanvasImageSource | null {
    if (this.latestCameraFrame) return this.latestCameraFrame;
    if (this.camera && this.cameraVideo.readyState >= 2 && this.cameraVideo.videoWidth > 0) {
      return this.cameraVideo;
    }
    return null;
  }

  private screenImage(): CanvasImageSource | null {
    if (this.screen && this.screenVideo.readyState >= 2 && this.screenVideo.videoWidth > 0) {
      return this.screenVideo;
    }
    return null;
  }

  private watchVideoFrames(video: HTMLVideoElement, slot: "camera" | "screen"): void {
    this.stopFrameWatch(video, slot);
    if (!("requestVideoFrameCallback" in video) || !video.srcObject) return;
    const tick = () => {
      if (this.destroyed || !video.srcObject) return;
      this.draw();
      const id = video.requestVideoFrameCallback(tick);
      if (slot === "camera") this.cameraFrame = id;
      else this.screenFrame = id;
    };
    const id = video.requestVideoFrameCallback(tick);
    if (slot === "camera") this.cameraFrame = id;
    else this.screenFrame = id;
  }

  private stopFrameWatch(video: HTMLVideoElement, slot: "camera" | "screen"): void {
    const id = slot === "camera" ? this.cameraFrame : this.screenFrame;
    if (id && "cancelVideoFrameCallback" in video) {
      video.cancelVideoFrameCallback(id);
    }
    if (slot === "camera") this.cameraFrame = 0;
    else this.screenFrame = 0;
  }

  private loop(): void {
    if (this.destroyed) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }

  private draw(screenFrame?: PaintFrame | null): void {
    if (this.camera) this.keepPlaying(this.cameraVideo);
    if (this.screen) this.keepPlaying(this.screenVideo);
    const { ctx, canvas } = this;
    ctx.fillStyle = "#0c0d12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const screenSource = screenFrame ?? this.screenImage();
    const cameraSource = this.cameraImage();

    if (this.screen && screenSource) {
      ctx.drawImage(screenSource, 0, 0, canvas.width, canvas.height);
      if (cameraSource) {
        const rect = overlayPixels(this.overlay, canvas.width, canvas.height, this.cameraAspect);
        this.drawCameraPip(cameraSource, rect.x, rect.y, rect.width, rect.height);
      }
      return;
    }

    if (cameraSource) {
      ctx.drawImage(cameraSource, 0, 0, canvas.width, canvas.height);
    }
  }

  private drawCameraPip(
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    const { ctx } = this;
    const radius = pipCornerRadius(width, height);
    ctx.save();
    pathRoundedRect(ctx, x, y, width, height, radius);
    ctx.clip();
    ctx.drawImage(source, x, y, width, height);
    ctx.restore();
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
