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
import { IconDownload, IconPause, IconPlay } from "../icons";
import type { AudioRecordingResult } from "../types";
import { downloadBlob, formatClock } from "../utils";
import { AudioCapture, type AudioCaptureSnapshot } from "./AudioCapture";

export type AudioRecorderHandle = {
  start: () => Promise<void>;
  stop: () => Promise<AudioRecordingResult | null>;
  pause: () => void;
  resume: () => void;
  download: (filename?: string) => void;
  getLastRecording: () => AudioRecordingResult | null;
};

export type AudioRecorderProps = {
  className?: string;
  style?: React.CSSProperties;
  showControls?: boolean;
  /** Shows a Download control after a take. Off by default; use `onRecordingStop` or `download()`. */
  showDownload?: boolean;
  onRecordingStart?: () => void;
  onRecordingStop?: (result: AudioRecordingResult) => void;
  onRecordingPause?: () => void;
  onRecordingResume?: () => void;
  onError?: (error: Error) => void;
};

const INITIAL: AudioCaptureSnapshot = {
  status: "idle",
  error: null,
  durationMs: 0,
  hasRecording: false,
  capabilities: {
    microphone: false,
    mediaRecorder: false,
    mimeType: "",
    notes: {},
  },
};

export const AudioRecorder = forwardRef<AudioRecorderHandle, AudioRecorderProps>(
  function AudioRecorder(
    {
      className,
      style,
      showControls = true,
      showDownload = false,
      onRecordingStart,
      onRecordingStop,
      onRecordingPause,
      onRecordingResume,
      onError,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const captureRef = useRef<AudioCapture | null>(null);
    const [snap, setSnap] = useState<AudioCaptureSnapshot>(INITIAL);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const capture = new AudioCapture(canvas);
      captureRef.current = capture;
      const unsub = capture.subscribe(setSnap);
      return () => {
        unsub();
        capture.destroy();
        captureRef.current = null;
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
      const capture = captureRef.current;
      if (!capture) return;
      setBusy(true);
      try {
        await capture.startRecording();
        onRecordingStart?.();
      } catch (error) {
        report(error);
      } finally {
        setBusy(false);
      }
    }, [onRecordingStart, report]);

    const stop = useCallback(async () => {
      const capture = captureRef.current;
      if (!capture) return null;
      setBusy(true);
      try {
        const result = await capture.stopRecording();
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
      captureRef.current?.pauseRecording();
      onRecordingPause?.();
    }, [onRecordingPause]);

    const resume = useCallback(() => {
      captureRef.current?.resumeRecording();
      onRecordingResume?.();
    }, [onRecordingResume]);

    const download = useCallback((filename?: string) => {
      const recording = captureRef.current?.lastRecording;
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
        download,
        getLastRecording: () => captureRef.current?.lastRecording ?? null,
      }),
      [download, pause, resume, start, stop],
    );

    const live = snap.status === "recording" || snap.status === "paused";
    const canPause =
      typeof MediaRecorder !== "undefined" && typeof MediaRecorder.prototype.pause === "function";
    const canRecord = snap.capabilities.microphone && snap.capabilities.mediaRecorder && Boolean(snap.capabilities.mimeType);

    const statusLabel = useMemo(() => {
      if (snap.status === "recording") return `REC ${formatClock(snap.durationMs)}`;
      if (snap.status === "paused") return `PAUSED ${formatClock(snap.durationMs)}`;
      if (snap.hasRecording) return `Ready ${formatClock(snap.durationMs)}`;
      return "Idle";
    }, [snap.durationMs, snap.hasRecording, snap.status]);

    const statusAnnounce = useMemo(() => {
      if (snap.status === "recording") return "Recording audio";
      if (snap.status === "paused") return "Audio recording paused";
      if (snap.hasRecording) return "Audio take ready";
      return "Audio recorder idle";
    }, [snap.hasRecording, snap.status]);

    const recordingHint = snap.capabilities.notes.recording ?? snap.capabilities.notes.microphone;

    return (
      <div
        className={["rmt-recorder", "rmt-recorder--audio", className].filter(Boolean).join(" ")}
        style={style}
        role="region"
        aria-label="Audio recorder"
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
            aria-label="Microphone level"
          />
          {!live && (
            <div className="rmt-recorder__empty">
              <strong>{snap.hasRecording ? "Take ready" : "Start to record audio"}</strong>
              <span>
                {snap.hasRecording
                  ? "Download the file, or start again to replace it."
                  : "Uses the microphone. Stop to get an audio file."}
              </span>
            </div>
          )}
          <div className={`rmt-recorder__badge rmt-recorder__badge--${snap.status}`} aria-hidden="true">
            <span className="rmt-recorder__dot" />
            {statusLabel}
          </div>
        </div>

        {showControls && (
          <div className="rmt-recorder__controls">
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
                  title={recordingHint}
                  aria-label={recordingHint ? `Start. ${recordingHint}` : undefined}
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
