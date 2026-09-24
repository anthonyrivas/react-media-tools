import type { ReactNode } from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconButton } from "../IconButton";
import { IconCamera, IconDownload, IconMic, IconPause, IconPlay, IconScreen, IconSpeaker } from "../icons";
import type { CameraOverlay, RecordingResult, SourceName } from "../types";
import { downloadBlob, formatClock } from "../utils";
import { MediaComposer, type ComposerSnapshot } from "./video/MediaComposer";
import { OverlayLayer } from "./video/OverlayLayer";

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

    const statusLabel = useMemo(() => {
      if (snap.status === "recording") return `REC ${formatClock(snap.durationMs)}`;
      if (snap.status === "paused") return `PAUSED ${formatClock(snap.durationMs)}`;
      if (snap.status === "preview") return "Preview";
      return "Idle";
    }, [snap.durationMs, snap.status]);

    const statusAnnounce = useMemo(() => {
      if (snap.status === "recording") return "Recording";
      if (snap.status === "paused") return "Recording paused";
      if (snap.status === "preview") return "Preview";
      return "Recorder idle";
    }, [snap.status]);

    const previewLabel = compositing
      ? "Camera over screen preview"
      : snap.camera
        ? "Camera preview"
        : snap.screen
          ? "Screen preview"
          : "Recorder preview";

    return (
      <div
        className={["rmt-recorder", className].filter(Boolean).join(" ")}
        style={style}
        role="region"
        aria-label="Video recorder"
        aria-busy={busy}
      >
        <div className="rmt-sr-only" role="status" aria-live="polite">
          {statusAnnounce}
        </div>
        <div className="rmt-recorder__stage">
          <canvas
            ref={canvasRef}
            className="rmt-recorder__canvas"
            role="img"
            aria-label={previewLabel}
          />
          <OverlayLayer
            canvasWidth={snap.canvasWidth}
            canvasHeight={snap.canvasHeight}
            aspect={snap.cameraAspect}
            overlay={snap.overlay}
            visible={compositing}
            onChange={setOverlay}
          />
          {!snap.camera && !snap.screen && !live && (
            <div className="rmt-recorder__empty">
              <strong>Choose a source to preview</strong>
              <span>Camera, screen, or both. The webcam stays movable on top of a screen share.</span>
            </div>
          )}
          <div className={`rmt-recorder__badge rmt-recorder__badge--${snap.status}`} aria-hidden="true">
            <span className="rmt-recorder__dot" />
            {statusLabel}
          </div>
          {snap.sizeLocked && (
            <div className="rmt-recorder__lock">
              Output {snap.canvasWidth}×{snap.canvasHeight} locked while recording
            </div>
          )}
        </div>

        {showControls && (
          <div className="rmt-recorder__controls">
            <div className="rmt-recorder__sources" role="group" aria-label="Capture sources">
              <SourceToggle
                label="Camera"
                icon={<IconCamera />}
                pressed={snap.camera}
                disabled={!snap.capabilities.camera || busy}
                title={snap.capabilities.notes.camera}
                onClick={() => void setSource("camera", !snap.camera)}
              />
              <SourceToggle
                label="Screen"
                icon={<IconScreen />}
                pressed={snap.screen}
                disabled={!snap.capabilities.screen || busy}
                title={snap.capabilities.notes.screen}
                onClick={() => void setSource("screen", !snap.screen)}
              />
              <SourceToggle
                label="Microphone"
                icon={<IconMic />}
                pressed={snap.microphone || (wantMic && !live)}
                disabled={!snap.capabilities.microphone || busy}
                title={snap.capabilities.notes.microphone}
                onClick={() => {
                  const next = !(snap.microphone || (wantMic && !live));
                  setWantMic(next);
                  void setSource("microphone", next);
                }}
              />
              <SourceToggle
                label="System audio"
                icon={<IconSpeaker />}
                pressed={snap.systemAudio}
                disabled={!snap.capabilities.systemAudio || busy}
                title={
                  snap.systemAudio && !snap.systemAudioTrack
                    ? "Enable “Share audio” in the browser prompt."
                    : snap.capabilities.notes.systemAudio
                }
                onClick={() => void setSource("systemAudio", !snap.systemAudio)}
              />
            </div>

            <div className="rmt-recorder__actions" role="group" aria-label="Recording actions">
              {snap.status === "recording" && canPause && (
                <IconButton label="Pause" disabled={busy} onClick={pause}>
                  <IconPause />
                </IconButton>
              )}
              {snap.status === "paused" && (
                <IconButton label="Resume" disabled={busy} onClick={resume}>
                  <IconPlay />
                </IconButton>
              )}
              {live ? (
                <button
                  type="button"
                  className="rmt-btn rmt-btn--danger"
                  onClick={() => void stop()}
                  disabled={busy}
                >
                  {busy ? "Stopping…" : "Stop"}
                </button>
              ) : (
                <button
                  type="button"
                  className="rmt-btn rmt-btn--primary"
                  onClick={() => void start()}
                  disabled={busy || !canRecord}
                  title={snap.capabilities.notes.recording}
                  aria-label={
                    !canRecord && snap.capabilities.notes.recording
                      ? `Start. ${snap.capabilities.notes.recording}`
                      : undefined
                  }
                >
                  {busy ? "Starting…" : "Start"}
                </button>
              )}
              {showDownload && (
                <IconButton
                  label="Download"
                  disabled={!snap.hasRecording || live || busy}
                  onClick={() => download()}
                >
                  <IconDownload />
                </IconButton>
              )}
            </div>
          </div>
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

function SourceToggle({
  label,
  pressed,
  disabled,
  title,
  icon,
  onClick,
}: {
  label: string;
  pressed: boolean;
  disabled?: boolean;
  title?: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  const hint = title?.trim();
  const name = hint ? `${label}. ${hint}` : label;
  return (
    <IconButton label={name} pressed={pressed} disabled={disabled} title={name} onClick={onClick}>
      {icon}
    </IconButton>
  );
}
