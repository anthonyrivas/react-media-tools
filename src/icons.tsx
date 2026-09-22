import type { ReactNode } from "react";

export function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8.4 6.2v11.6l9.4-5.8z" />
    </svg>
  );
}

export function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect fill="currentColor" x="7" y="6" width="3.2" height="12" rx="1" />
      <rect fill="currentColor" x="13.8" y="6" width="3.2" height="12" rx="1" />
    </svg>
  );
}

export function IconSplit() {
  return (
    <IconSvg>
      <path d="M8 9 5 12l3 3" />
      <path d="m16 9 3 3-3 3" />
      <path d="M12 4v6" />
      <path d="M12 14v6" />
    </IconSvg>
  );
}

export function IconSplitTracks() {
  return (
    <IconSvg>
      <path d="M4 8h16" />
      <path d="M4 16h16" />
      <path d="M12 4v16" />
    </IconSvg>
  );
}

export function IconTrash() {
  return (
    <IconSvg>
      <path d="M5 7h14" />
      <path d="M10 7V5h4v2" />
      <path d="M8 7v12h8V7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </IconSvg>
  );
}

export function IconUndo() {
  return (
    <IconSvg>
      <path d="M3 9h10a5 5 0 1 1 0 10H9" />
      <path d="M7 5 3 9l4 4" />
    </IconSvg>
  );
}

export function IconRedo() {
  return (
    <IconSvg>
      <path d="M21 9H11a5 5 0 1 0 0 10h4" />
      <path d="m17 5 4 4-4 4" />
    </IconSvg>
  );
}

export function IconOpen() {
  return (
    <IconSvg>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h4.2l1.8 2H19.5A1.5 1.5 0 0 1 21 10.5v7A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    </IconSvg>
  );
}

export function IconCamera() {
  return (
    <IconSvg>
      <path d="M8 8 9.6 5.8h4.8L16 8" />
      <rect x="3.5" y="8" width="17" height="11.5" rx="2" />
      <circle cx="12" cy="13.6" r="3.2" />
    </IconSvg>
  );
}

export function IconScreen() {
  return (
    <IconSvg>
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="2" />
      <path d="M12 16v3.5" />
      <path d="M8 20h8" />
    </IconSvg>
  );
}

export function IconMic() {
  return (
    <IconSvg>
      <rect x="9" y="3.5" width="6" height="10.5" rx="3" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" />
      <path d="M12 17v3.5" />
      <path d="M9 20.5h6" />
    </IconSvg>
  );
}

export function IconSpeaker() {
  return (
    <IconSvg>
      <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4z" />
      <path d="M15.6 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path d="M18.2 7.2a6.5 6.5 0 0 1 0 9.6" />
    </IconSvg>
  );
}

export function IconMinus() {
  return (
    <IconSvg>
      <path d="M5 12h14" />
    </IconSvg>
  );
}

export function IconPlus() {
  return (
    <IconSvg>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconSvg>
  );
}

export function IconDownload() {
  return (
    <IconSvg>
      <path d="M12 4v11" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </IconSvg>
  );
}

export function IconMute() {
  return (
    <IconSvg>
      <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4z" />
      <path d="m15 9 6 6" />
      <path d="m21 9-6 6" />
    </IconSvg>
  );
}

export function IconUnlink() {
  return (
    <IconSvg>
      <path d="M8.8 15.2 7 17a3.2 3.2 0 0 1-4.5-4.5l2.5-2.5A3.2 3.2 0 0 1 9.2 10" />
      <path d="M15.2 8.8 17 7a3.2 3.2 0 0 1 4.5 4.5l-2.5 2.5A3.2 3.2 0 0 1 14.8 14" />
      <path d="m9 15 6-6" />
    </IconSvg>
  );
}
