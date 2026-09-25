import type { ReactNode, RefObject } from "react";
import { IconButton } from "../../IconButton";
import { IconCamera, IconDownload, IconMic, IconPause, IconPlay, IconScreen, IconSpeaker } from "../../icons";
import type { CameraOverlay } from "../../types";
import type { ComposerSnapshot } from "./MediaComposer";
import { OverlayLayer } from "./OverlayLayer";
import { microphoneArmed, systemAudioHint } from "./recorderView";

export function VideoRecorderStage({
  canvasRef,
  snap,
  compositing,
  live,
  previewLabel,
  statusLabel,
  onOverlayChange,
}: {
  canvasRef: RefObject<HTMLCanvasElement>;
  snap: ComposerSnapshot;
  compositing: boolean;
  live: boolean;
  previewLabel: string;
  statusLabel: string;
  onOverlayChange: (overlay: CameraOverlay) => void;
}) {
  return (
    <div className="rmt-recorder__stage">
      <canvas ref={canvasRef} className="rmt-recorder__canvas" role="img" aria-label={previewLabel} />
      <OverlayLayer
        canvasWidth={snap.canvasWidth}
        canvasHeight={snap.canvasHeight}
        aspect={snap.cameraAspect}
        overlay={snap.overlay}
        visible={compositing}
        onChange={onOverlayChange}
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
  );
}

export function VideoRecorderControls({
  snap,
  busy,
  live,
  wantMic,
  canPause,
  canRecord,
  showDownload,
  onToggleSource,
  onToggleMic,
  onPause,
  onResume,
  onStart,
  onStop,
  onDownload,
}: {
  snap: ComposerSnapshot;
  busy: boolean;
  live: boolean;
  wantMic: boolean;
  canPause: boolean;
  canRecord: boolean;
  showDownload: boolean;
  onToggleSource: (source: "camera" | "screen" | "systemAudio", enabled: boolean) => void;
  onToggleMic: () => void;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onDownload: () => void;
}) {
  const micOn = microphoneArmed(snap.microphone, wantMic, live);
  return (
    <div className="rmt-recorder__controls">
      <VideoRecorderSources snap={snap} busy={busy} micOn={micOn} onToggleSource={onToggleSource} onToggleMic={onToggleMic} />
      <VideoRecorderActions
        snap={snap}
        busy={busy}
        live={live}
        canPause={canPause}
        canRecord={canRecord}
        showDownload={showDownload}
        onPause={onPause}
        onResume={onResume}
        onStart={onStart}
        onStop={onStop}
        onDownload={onDownload}
      />
    </div>
  );
}

function VideoRecorderSources({
  snap,
  busy,
  micOn,
  onToggleSource,
  onToggleMic,
}: {
  snap: ComposerSnapshot;
  busy: boolean;
  micOn: boolean;
  onToggleSource: (source: "camera" | "screen" | "systemAudio", enabled: boolean) => void;
  onToggleMic: () => void;
}) {
  return (
    <div className="rmt-recorder__sources" role="group" aria-label="Capture sources">
      <SourceToggle
        label="Camera"
        icon={<IconCamera />}
        pressed={snap.camera}
        disabled={!snap.capabilities.camera || busy}
        title={snap.capabilities.notes.camera}
        onClick={() => onToggleSource("camera", !snap.camera)}
      />
      <SourceToggle
        label="Screen"
        icon={<IconScreen />}
        pressed={snap.screen}
        disabled={!snap.capabilities.screen || busy}
        title={snap.capabilities.notes.screen}
        onClick={() => onToggleSource("screen", !snap.screen)}
      />
      <SourceToggle
        label="Microphone"
        icon={<IconMic />}
        pressed={micOn}
        disabled={!snap.capabilities.microphone || busy}
        title={snap.capabilities.notes.microphone}
        onClick={onToggleMic}
      />
      <SourceToggle
        label="System audio"
        icon={<IconSpeaker />}
        pressed={snap.systemAudio}
        disabled={!snap.capabilities.systemAudio || busy}
        title={systemAudioHint(snap.systemAudio, snap.systemAudioTrack, snap.capabilities.notes.systemAudio)}
        onClick={() => onToggleSource("systemAudio", !snap.systemAudio)}
      />
    </div>
  );
}

function VideoRecorderActions({
  snap,
  busy,
  live,
  canPause,
  canRecord,
  showDownload,
  onPause,
  onResume,
  onStart,
  onStop,
  onDownload,
}: {
  snap: ComposerSnapshot;
  busy: boolean;
  live: boolean;
  canPause: boolean;
  canRecord: boolean;
  showDownload: boolean;
  onPause: () => void;
  onResume: () => void;
  onStart: () => void;
  onStop: () => void;
  onDownload: () => void;
}) {
  return (
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
        <IconButton label="Download" disabled={!snap.hasRecording || live || busy} onClick={onDownload}>
          <IconDownload />
        </IconButton>
      )}
    </div>
  );
}

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
