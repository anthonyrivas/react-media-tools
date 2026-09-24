/** A decoded video frame that can be painted and must be closed. */
export type PaintFrame = CanvasImageSource & { close: () => void };

type TrackProcessor = {
  readable: ReadableStream<PaintFrame>;
};

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => TrackProcessor;

function processorCtor(): TrackProcessorCtor | undefined {
  const ctor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
  return typeof ctor === "function" ? ctor : undefined;
}

/**
 * Pull decoded frames from a track without requestAnimationFrame.
 * Display-media and camera tracks keep producing in a background tab;
 * rAF and requestVideoFrameCallback do not.
 */
export function pumpTrackFrames(
  track: MediaStreamTrack,
  onFrame: (frame: PaintFrame) => void,
): () => void {
  const Processor = processorCtor();
  if (!Processor || track.kind !== "video" || track.readyState !== "live") {
    return () => undefined;
  }
  const cloned = track.clone();
  const reader = new Processor({ track: cloned }).readable.getReader();
  let stopped = false;

  void (async () => {
    try {
      while (!stopped) {
        const next = await reader.read();
        if (next.done || !next.value) break;
        if (stopped) {
          next.value.close();
          break;
        }
        onFrame(next.value);
      }
    } catch {
      // Track ended or browser closed the processor.
    }
  })();

  return () => {
    stopped = true;
    void reader.cancel().catch(() => undefined);
    cloned.stop();
  };
}

/** Tick the compositor when the page is hidden and rAF is paused. */
export function startBackgroundDrawClock(onTick: () => void, fps = 30): () => void {
  if (typeof Worker === "undefined") {
    const timer = window.setInterval(onTick, Math.round(1000 / fps));
    return () => window.clearInterval(timer);
  }
  const source = `setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    const worker = new Worker(url);
    worker.onmessage = () => onTick();
    return () => worker.terminate();
  } catch {
    const timer = window.setInterval(onTick, Math.round(1000 / fps));
    return () => window.clearInterval(timer);
  } finally {
    URL.revokeObjectURL(url);
  }
}
