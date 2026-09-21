import type { ReactNode } from "react";

export function IconButton({
  label,
  shortcut,
  keyshortcuts: keyshortcutsProp,
  disabled,
  pressed,
  title,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  keyshortcuts?: string;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const hint = title ?? (shortcut ? `${label} (${shortcut})` : label);
  const keyshortcuts =
    keyshortcutsProp ??
    shortcut
      ?.replaceAll("⌘+", "Meta+")
      .replaceAll("⌘", "Meta+")
      .replaceAll("Ctrl+", "Control+")
      .replaceAll("Ctrl", "Control");
  return (
    <button
      type="button"
      className="rmt-btn rmt-btn--icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={keyshortcuts}
      title={hint}
    >
      {children}
    </button>
  );
}
