import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraOverlay } from "../../types";
import { objectFitContainRect } from "../../utils";
import { clampOverlay, overlayHeightFrac, pipCornerRadius } from "./overlay";

type Corner = "nw" | "ne" | "sw" | "se";

type OverlayLayerProps = {
  canvasWidth: number;
  canvasHeight: number;
  aspect: number;
  overlay: CameraOverlay;
  visible: boolean;
  onChange: (overlay: CameraOverlay) => void;
};

export function OverlayLayer({
  canvasWidth,
  canvasHeight,
  aspect,
  overlay,
  visible,
  onChange,
}: OverlayLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const drag = useRef<{
    mode: "move" | Corner;
    startX: number;
    startY: number;
    origin: CameraOverlay;
    pointerId: number;
    target: HTMLElement;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const measure = () => {
      const box = host.getBoundingClientRect();
      setFrame(objectFitContainRect(box.width, box.height, canvasWidth, canvasHeight));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [canvasWidth, canvasHeight]);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const session = drag.current;
      if (!session || !frame.w || !frame.h) return;
      const dx = (event.clientX - session.startX) / frame.w;
      const dy = (event.clientY - session.startY) / frame.h;
      const next = { ...session.origin };

      if (session.mode === "move") {
        next.x = session.origin.x + dx;
        next.y = session.origin.y + dy;
      } else {
        const heightOf = (width: number) =>
          overlayHeightFrac({ ...session.origin, width }, canvasWidth, canvasHeight, aspect);
        const startH = heightOf(session.origin.width);
        let { x, y, width } = session.origin;
        if (session.mode === "se" || session.mode === "ne") {
          width = session.origin.width + dx;
        } else {
          width = session.origin.width - dx;
          x = session.origin.x + (session.origin.width - width);
        }
        const nextH = heightOf(width);
        if (session.mode === "ne" || session.mode === "nw") {
          y = session.origin.y + startH - nextH;
        }
        next.x = x;
        next.y = y;
        next.width = width;
      }
      onChange(next);
    },
    [aspect, canvasHeight, canvasWidth, frame.h, frame.w, onChange],
  );

  const endDrag = useCallback(() => {
    const session = drag.current;
    if (session) {
      try {
        session.target.releasePointerCapture(session.pointerId);
      } catch {
        /* capture may already be released */
      }
    }
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
  }, [onPointerMove]);

  const begin = (mode: "move" | Corner, event: React.PointerEvent) => {
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const pip = target.closest(".rmt-pip") as HTMLElement | null;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      /* older Safari */
    }
    pip?.focus({ preventScroll: true });
    drag.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: overlay,
      pointerId: event.pointerId,
      target,
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  const onKeyMove = (event: React.KeyboardEvent) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.03 : 0.015;
    const next = { ...overlay };
    if (event.shiftKey) {
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next.width -= step;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next.width += step;
    } else {
      if (event.key === "ArrowLeft") next.x -= step;
      if (event.key === "ArrowRight") next.x += step;
      if (event.key === "ArrowUp") next.y -= step;
      if (event.key === "ArrowDown") next.y += step;
    }
    onChange(clampOverlay(next, canvasWidth, canvasHeight, aspect));
  };

  useEffect(() => () => endDrag(), [endDrag]);

  if (!visible || !frame.w) {
    return <div className="rmt-overlay-host" ref={hostRef} />;
  }

  const heightFrac = overlayHeightFrac(overlay, canvasWidth, canvasHeight, aspect);
  const left = frame.x + overlay.x * frame.w;
  const top = frame.y + overlay.y * frame.h;
  const width = overlay.width * frame.w;
  const height = heightFrac * frame.h;
  const radius =
    pipCornerRadius(overlay.width * canvasWidth, heightFrac * canvasHeight) * (frame.w / canvasWidth);

  return (
    <div className="rmt-overlay-host" ref={hostRef}>
      <div
        className="rmt-pip"
        role="group"
        tabIndex={0}
        aria-label="Camera overlay. Arrow keys move, Shift+arrow resizes."
        style={{ left, top, width, height, borderRadius: radius }}
        onPointerDown={(event) => begin("move", event)}
        onKeyDown={onKeyMove}
      >
        <span className="rmt-pip__label">Camera</span>
        {(["nw", "ne", "sw", "se"] as const).map((corner) => (
          <button
            key={corner}
            type="button"
            className={`rmt-pip__handle rmt-pip__handle--${corner}`}
            tabIndex={-1}
            aria-label={`Resize camera overlay ${corner.toUpperCase()}`}
            onPointerDown={(event) => begin(corner, event)}
          />
        ))}
      </div>
    </div>
  );
}
