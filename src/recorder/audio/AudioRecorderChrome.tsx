import type { RefObject } from "react";
import { IconButton } from "../../IconButton";
import { IconDownload, IconPause, IconPlay } from "../../icons";
import type { AudioCaptureSnapshot } from "./AudioCapture";
import { audioRecorderEmptyCopy } from "./audioRecorderView";

export function AudioRecorderStage({
  canvasRef,
  snap,
  live,
  statusLabel,
}: {
  canvasRef: RefObject<HTMLCanvasElement>;
  snap: AudioCaptureSnapshot;
  live: boolean;
  statusLabel: string;
}) {
  const empty = audioRecorderEmptyCopy(snap.hasRecording);
  return (
    <div className="rmt-recorder__stage">
      <canvas ref={canvasRef} className="rmt-recorder__canvas" role="img" aria-label="Microphone level" />
      {!live && (
        <div className="rmt-recorder__empty">
          <strong>{empty.title}</strong>
          <span>{empty.body}</span>
        </div>
      )}
      <div className={`rmt-recorder__badge rmt-recorder__badge--${snap.status}`} aria-hidden="true">
        <span className="rmt-recorder__dot" />
        {statusLabel}
      </div>
    </div>
  );
}

export function AudioRecorderActions({
  snap,
  busy,
  live,
  canPause,
  canRecord,
  showDownload,
  startHint,
  onPause,
  onResume,
  onStart,
  onStop,
  onDownload,
}: {
  snap: AudioCaptureSnapshot;
  busy: boolean;
  live: boolean;
  canPause: boolean;
  canRecord: boolean;
  showDownload: boolean;
  startHint?: string;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="rmt-recorder__controls">
      <div className="rmt-recorder__actions" role="group" aria-label="Recording actions">
        {snap.status === "recording" && canPause && (
          <IconButton label="Pause" disabled={busy} onClick={onPause}>
            <IconPause />
          </IconButton>
        )}
        {snap.status === "paused" && (
          <IconButton label="Resume" disabled={busy} onClick={onResume}>
            <IconPlay />
          </IconButton>
        )}
        {live ? (
          <button type="button" className="rmt-btn rmt-btn--danger" onClick={onStop} disabled={busy}>
            {busy ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <button
            type="button"
            className="rmt-btn rmt-btn--primary"
            onClick={onStart}
            disabled={busy || !canRecord}
            title={startHint}
            aria-label={startHint ? `Start. ${startHint}` : undefined}
          >
            {busy ? "Starting…" : "Start"}
          </button>
        )}
        {showDownload && (
          <IconButton label="Download" disabled={!snap.hasRecording || live || busy} onClick={onDownload}>
            <IconDownload />
          </IconButton>
        )}
      </div>
    </div>
  );
}
