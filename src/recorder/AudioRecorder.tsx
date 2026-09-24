import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { AudioRecordingResult } from "../types";
import { downloadBlob } from "../utils";
import { AudioCapture, type AudioCaptureSnapshot } from "./audio/AudioCapture";
import { AudioRecorderActions, AudioRecorderStage } from "./audio/AudioRecorderChrome";
import {
  audioRecorderStartHint,
  audioRecorderStatusAnnounce,
  audioRecorderStatusLabel,
} from "./audio/audioRecorderView";

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
    const canRecord =
      snap.capabilities.microphone && snap.capabilities.mediaRecorder && Boolean(snap.capabilities.mimeType);

    return (
      <div
        className={["rmt-recorder", "rmt-recorder--audio", className].filter(Boolean).join(" ")}
        style={style}
        role="region"
        aria-label="Audio recorder"
        aria-busy={busy}
      >
        <div className="rmt-sr-only" role="status" aria-live="polite">
          {audioRecorderStatusAnnounce(snap.status, snap.hasRecording)}
        </div>
        <AudioRecorderStage
          canvasRef={canvasRef}
          snap={snap}
          live={live}
          statusLabel={audioRecorderStatusLabel(snap.status, snap.durationMs, snap.hasRecording)}
        />
        {showControls && (
          <AudioRecorderActions
            snap={snap}
            busy={busy}
            live={live}
            canPause={canPause}
            canRecord={canRecord}
            showDownload={showDownload}
            startHint={audioRecorderStartHint(snap.capabilities.notes)}
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
