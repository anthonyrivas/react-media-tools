import type { CSSProperties, DragEvent, ReactNode, RefObject } from "react";
import { IconButton } from "../IconButton";
import {
  IconDownload,
  IconDuplicate,
  IconMute,
  IconOpen,
  IconPause,
  IconPlay,
  IconRedo,
  IconSpeaker,
  IconSplit,
  IconSplitTracks,
  IconTrash,
  IconUndo,
  IconUnlink,
} from "../icons";
import { formatPrecise } from "../utils";
import { shortcutMod } from "./editorDom";

type DropHandlers = {
  onDragEnter: (event: DragEvent) => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: (event: DragEvent) => void;
  onDrop: (event: DragEvent) => void;
};

export function EditorShell({
  rootRef,
  className,
  style,
  label,
  busy,
  fileHover,
  drop,
  children,
}: {
  rootRef: RefObject<HTMLDivElement>;
  className?: string;
  style?: CSSProperties;
  label: string;
  busy: boolean;
  fileHover: boolean;
  drop: DropHandlers;
  children: ReactNode;
}) {
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={["rmt-editor", fileHover ? "is-file-hover" : "", className].filter(Boolean).join(" ")}
      style={style}
      role="region"
      aria-label={label}
      aria-busy={busy}
      onDragEnter={drop.onDragEnter}
      onDragOver={drop.onDragOver}
      onDragLeave={drop.onDragLeave}
      onDrop={drop.onDrop}
    >
      {children}
    </div>
  );
}

export function EditorTools({
  hasClips,
  selected,
  busy,
  canUndo,
  canRedo,
  showOpenFile,
  onSplit,
  onSplitAll,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  onOpen,
}: {
  hasClips: boolean;
  selected: boolean;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showOpenFile: boolean;
  onSplit: () => void;
  onSplitAll?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="rmt-editor__tools">
      <IconButton label="Split" shortcut="S" disabled={!hasClips} onClick={onSplit}>
        <IconSplit />
      </IconButton>
      {onSplitAll && (
        <IconButton label="Split all tracks" shortcut="Shift+S" disabled={!hasClips} onClick={onSplitAll}>
          <IconSplitTracks />
        </IconButton>
      )}
      <IconButton label="Duplicate" shortcut="D" disabled={!selected} onClick={onDuplicate}>
        <IconDuplicate />
      </IconButton>
      <IconButton label="Delete" shortcut="Delete" disabled={!selected} onClick={onDelete}>
        <IconTrash />
      </IconButton>
      <span className="rmt-editor__tools-gap" aria-hidden="true" />
      <IconButton label="Undo" shortcut={`${shortcutMod()}Z`} disabled={!canUndo} onClick={onUndo}>
        <IconUndo />
      </IconButton>
      <IconButton label="Redo" shortcut={`${shortcutMod()}+Shift+Z`} disabled={!canRedo} onClick={onRedo}>
        <IconRedo />
      </IconButton>
      {showOpenFile && (
        <IconButton label="Open file" disabled={busy} onClick={onOpen}>
          <IconOpen />
        </IconButton>
      )}
    </div>
  );
}

export function EditorFileInput({
  fileRef,
  accept,
  onFiles,
}: {
  fileRef: RefObject<HTMLInputElement>;
  accept: string;
  onFiles: (files: File[]) => void;
}) {
  return (
    <input
      ref={fileRef}
      type="file"
      accept={accept}
      hidden
      multiple
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        onFiles([...(event.target.files ?? [])]);
        event.target.value = "";
      }}
    />
  );
}

export function EditorExportBar({
  exportLabel,
  progress,
  disabled,
  onExport,
  showDownload,
  downloadLabel,
  canDownload,
  onDownload,
}: {
  exportLabel: string;
  progress: number | null;
  disabled: boolean;
  onExport: () => void;
  showDownload: boolean;
  downloadLabel: string;
  canDownload: boolean;
  onDownload: () => void;
}) {
  const label = progress == null ? exportLabel : `${exportLabel} ${Math.round(progress * 100)}%`;
  return (
    <div className="rmt-editor__export">
      <button
        type="button"
        className="rmt-btn rmt-btn--primary"
        onClick={onExport}
        disabled={disabled}
        aria-label={progress == null ? exportLabel : `${exportLabel} ${Math.round(progress * 100)} percent`}
      >
        {label}
      </button>
      {progress != null && (
        <span className="rmt-sr-only" role="status">
          {exportLabel} {Math.round(progress * 100)}%
        </span>
      )}
      {showDownload && (
        <IconButton label={downloadLabel} disabled={!canDownload} onClick={onDownload}>
          <IconDownload />
        </IconButton>
      )}
    </div>
  );
}

export function EditorMixerBar({
  muted,
  muteDisabled,
  mutePressed,
  onMute,
  unlinkDisabled,
  onUnlink,
  gainPercent,
  gainDisabled,
  gainAriaText,
  gainText,
  onGain,
  onGainCommit,
  normalizeDisabled,
  onNormalize,
}: {
  muted: boolean;
  muteDisabled: boolean;
  mutePressed: boolean;
  onMute: () => void;
  unlinkDisabled?: boolean;
  onUnlink?: () => void;
  gainPercent: number;
  gainDisabled: boolean;
  gainAriaText: string;
  gainText: string;
  onGain: (percent: number) => void;
  onGainCommit: () => void;
  normalizeDisabled: boolean;
  onNormalize: () => void;
}) {
  return (
    <div className="rmt-editor__mixer">
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        shortcut="M"
        disabled={muteDisabled}
        pressed={mutePressed}
        onClick={onMute}
      >
        {muted ? <IconMute /> : <IconSpeaker />}
      </IconButton>
      {onUnlink && (
        <IconButton label="Unlink audio" shortcut="U" disabled={unlinkDisabled} onClick={onUnlink}>
          <IconUnlink />
        </IconButton>
      )}
      <label className="rmt-editor__gain">
        Gain
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={gainPercent}
          disabled={gainDisabled}
          aria-label="Gain"
          aria-valuetext={gainAriaText}
          onChange={(event) => onGain(Number(event.target.value))}
          onPointerUp={onGainCommit}
          onBlur={onGainCommit}
        />
        <span className="rmt-editor__gain-value">{gainText}</span>
      </label>
      <button type="button" className="rmt-btn" disabled={normalizeDisabled} onClick={onNormalize}>
        Normalize
      </button>
    </div>
  );
}

export function EditorPreviewFrame({
  playing,
  blank,
  hasClips,
  emptyTitle,
  emptyBody,
  playheadMs,
  totalMs,
  onToggle,
  children,
}: {
  playing: boolean;
  blank?: boolean;
  hasClips: boolean;
  emptyTitle: string;
  emptyBody: string;
  playheadMs: number;
  totalMs: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={[
        "rmt-editor__preview",
        hasClips ? (playing ? "is-playing" : "is-paused") : "",
        blank ? "is-blank" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (hasClips) onToggle();
      }}
    >
      {children}
      {!hasClips && (
        <div className="rmt-editor__empty">
          <strong>{emptyTitle}</strong>
          <span>{emptyBody}</span>
        </div>
      )}
      {hasClips && (
        <button
          type="button"
          className="rmt-editor__play"
          aria-label={playing ? "Pause" : "Play"}
          aria-keyshortcuts="Space"
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {playing ? <IconPause /> : <IconPlay />}
        </button>
      )}
      {hasClips && (
        <div className="rmt-editor__time" aria-hidden="true">
          {formatPrecise(playheadMs)} / {formatPrecise(totalMs)}
        </div>
      )}
    </div>
  );
}

export function EditorError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rmt-editor__error" role="alert">
      {error}
    </p>
  );
}
