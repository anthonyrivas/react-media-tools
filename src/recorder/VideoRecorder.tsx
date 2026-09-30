import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { CameraOverlay, RecordingResult, SourceName } from "../types";
import { downloadBlob } from "../utils";
import { MediaComposer, type ComposerSnapshot } from "./video/MediaComposer";
import { VideoRecorderControls, VideoRecorderStage } from "./video/VideoRecorderChrome";
import {
  microphoneArmed,
  videoRecorderPreviewLabel,
  videoRecorderStatusAnnounce,
  videoRecorderStatusLabel,
} from "./video/recorderView";

export type VideoRecorderHandle = {
  start: () => Promise<void>;
  stop: () => Promise<RecordingResult | null>;
  pause: () => void;
  resume: () => void;
  setSource: (source: SourceName, enabled: boolean) => Promise<void>;
  setOverlay: (overlay: CameraOverlay) => void;
  download: (filename?: string) => void;
  getLastRecording: () => RecordingResult | null;
};

export type VideoRecorderProps = {
  className?: string;
  style?: React.CSSProperties;
  showControls?: boolean;
  /** Shows a Download control after a take. Off by default; use `onRecordingStop` or `download()`. */
  showDownload?: boolean;
  defaultMicrophone?: boolean;
  onRecordingStart?: () => void;
  onRecordingStop?: (result: RecordingResult) => void;
  onRecordingPause?: () => void;
  onRecordingResume?: () => void;
  onError?: (error: Error) => void;
};

const INITIAL: ComposerSnapshot = {
  status: "idle",
  camera: false,
  screen: false,
  microphone: false,
  systemAudio: false,
  systemAudioTrack: false,
  error: null,
  durationMs: 0,
  canvasWidth: 1280,
  canvasHeight: 720,
  overlay: { x: 0.74, y: 0.7, width: 0.22 },
  cameraAspect: 16 / 9,
  capabilities: {
    mediaDevices: false,
    camera: false,
    microphone: false,
    screen: false,
    systemAudio: false,
    mediaRecorder: false,
    canvasCapture: false,
    mimeType: "",
    notes: {},
  },
  sizeLocked: false,
  hasRecording: false,
};

export const VideoRecorder = forwardRef<VideoRecorderHandle, VideoRecorderProps>(
  function VideoRecorder(
    {
      className,
      style,
      showControls = true,
      showDownload = false,
      defaultMicrophone = true,
      onRecordingStart,
      onRecordingStop,
      onRecordingPause,
      onRecordingResume,
      onError,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const composerRef = useRef<MediaComposer | null>(null);
    const [snap, setSnap] = useState<ComposerSnapshot>(INITIAL);
    const [busy, setBusy] = useState(false);
    const [wantMic, setWantMic] = useState(defaultMicrophone);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const composer = new MediaComposer(canvas);
      composerRef.current = composer;
      const unsub = composer.subscribe(setSnap);
      return () => {
        unsub();
        composer.destroy();
        composerRef.current = null;
      };
    }, []);

    const report = useCallback(
      (error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        onError?.(err);
      },
      [onError],
    );

    const start = useCallback(async () => {
      const composer = composerRef.current;
      if (!composer) return;
      setBusy(true);
      try {
        if (wantMic && !composer.microphone) {
          await composer.setSource("microphone", true).catch((error) => report(error));
        }
        await composer.startRecording();
        onRecordingStart?.();
      } catch (error) {
        report(error);
      } finally {
        setBusy(false);
      }
    }, [onRecordingStart, report, wantMic]);

    const stop = useCallback(async () => {
      const composer = composerRef.current;
      if (!composer) return null;
      setBusy(true);
      try {
        const result = await composer.stopRecording();
        if (result) onRecordingStop?.(result);
        return result;
      } catch (error) {
        report(error);
        return null;
      } finally {
        setBusy(false);
      }
    }, [onRecordingStop, report]);

    const pause = useCallback(() => {
      composerRef.current?.pauseRecording();
      onRecordingPause?.();
    }, [onRecordingPause]);

    const resume = useCallback(() => {
      composerRef.current?.resumeRecording();
      onRecordingResume?.();
    }, [onRecordingResume]);

    const setSource = useCallback(
      async (source: SourceName, enabled: boolean) => {
        try {
          await composerRef.current?.setSource(source, enabled);
        } catch (error) {
          report(error);
        }
      },
      [report],
    );

    const setOverlay = useCallback((overlay: CameraOverlay) => {
      composerRef.current?.setOverlay(overlay);
    }, []);

    const download = useCallback((filename?: string) => {
      const recording = composerRef.current?.lastRecording;
      if (!recording) return;
      downloadBlob(recording.blob, filename ?? recording.filename);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        start,
        stop,
        pause,
        resume,
        setSource,
        setOverlay,
        download,
        getLastRecording: () => composerRef.current?.lastRecording ?? null,
      }),
      [download, pause, resume, setOverlay, setSource, start, stop],
    );

    const compositing = snap.camera && snap.screen;
    const live = snap.status === "recording" || snap.status === "paused";
    const canPause =
      typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function";
    const canRecord = snap.capabilities.mediaRecorder && snap.capabilities.canvasCapture;

    return (
      <div
        className={["rmt-recorder", className].filter(Boolean).join(" ")}
        style={style}
        role="region"
        aria-label="Video recorder"
        aria-busy={busy}
      >
        <div className="rmt-sr-only" role="status" aria-live="polite">
          {videoRecorderStatusAnnounce(snap.status)}
        </div>
        <VideoRecorderStage
          canvasRef={canvasRef}
          snap={snap}
          compositing={compositing}
          live={live}
          previewLabel={videoRecorderPreviewLabel(snap.camera, snap.screen)}
          statusLabel={videoRecorderStatusLabel(snap.status, snap.durationMs)}
          onOverlayChange={setOverlay}
        />
        {showControls && (
          <VideoRecorderControls
            snap={snap}
            busy={busy}
            live={live}
            wantMic={wantMic}
            canPause={canPause}
            canRecord={canRecord}
            showDownload={showDownload}
            onToggleSource={(source, enabled) => void setSource(source, enabled)}
            onToggleMic={() => {
              const next = !microphoneArmed(snap.microphone, wantMic, live);
              setWantMic(next);
              void setSource("microphone", next);
            }}
            onPause={pause}
            onResume={resume}
            onStart={() => void start()}
            onStop={() => void stop()}
            onDownload={() => download()}
          />
        )}
        {snap.error && (
          <p className="rmt-recorder__error" role="alert">
            {snap.error}
          </p>
        )}
      </div>
    );
  },
);
