import { useEffect, useRef, type MutableRefObject } from "react";

type PlaybackClock = {
  playing: boolean;
  mediaRef: { readonly current: HTMLMediaElement | null };
  seekingRef: MutableRefObject<boolean>;
  playingRef: MutableRefObject<boolean>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  onPlay: () => Promise<void> | void;
  onTick: (input: { now: number; dt: number; keepPlaying: () => void }) => boolean;
  onEnded: () => void;
};

export function usePlaybackClock({
  playing,
  mediaRef,
  seekingRef,
  playingRef,
  audioCtxRef,
  onPlay,
  onTick,
  onEnded,
}: PlaybackClock) {
  const onPlayRef = useRef(onPlay);
  const onTickRef = useRef(onTick);
  const onEndedRef = useRef(onEnded);
  onPlayRef.current = onPlay;
  onTickRef.current = onTick;
  onEndedRef.current = onEnded;

  useEffect(() => {
    if (!playing) return;
    const media = mediaRef.current;
    if (!media) return;
    let raf = 0;
    let active = true;
    let last = performance.now();

    const keepPlaying = () => {
      if (active && playingRef.current && media.paused && !seekingRef.current) {
        void media.play().catch(() => undefined);
      }
    };

    const tick = (now: number) => {
      if (!active) return;
      const dt = now - last;
      last = now;
      if (!onTickRef.current({ now, dt, keepPlaying })) return;
      raf = requestAnimationFrame(tick);
    };

    const ended = () => {
      if (active) onEndedRef.current();
    };

    media.addEventListener("ended", ended);
    void audioCtxRef.current?.resume();
    void Promise.resolve(onPlayRef.current()).then(() => {
      if (active) raf = requestAnimationFrame(tick);
    });

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      media.removeEventListener("ended", ended);
    };
  }, [audioCtxRef, mediaRef, playing, playingRef, seekingRef]);
}
