import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { EditorClip } from "../../types";
import { envelopeAt } from "../shared/audioGain";
import {
  attachElementGraph,
  clearMediaElement,
  cueMediaClip,
  playheadFromClipTime,
  sameSourceCutContinues,
} from "../shared/editorPlayback";
import { clamp, clipDuration, clipStartMs, locateClip, totalDuration } from "../timeline/timelineMath";
import { useLiveGraph } from "../shared/useLiveGraph";
import { usePlaybackClock } from "../shared/usePlaybackClock";
import { usePlayheadScrub } from "../shared/usePlayheadScrub";

type PreviewSource = { id: string; url: string };

type AudioPreview = {
  clips: EditorClip[];
  clipsRef: MutableRefObject<EditorClip[]>;
  sourcesRef: MutableRefObject<Record<string, PreviewSource>>;
  playheadRef: MutableRefObject<number>;
  setPlayhead: (ms: number) => number;
  playing: boolean;
  playingRef: MutableRefObject<boolean>;
  setPlaying: (update: boolean | ((current: boolean) => boolean)) => void;
  clipIndexRef: MutableRefObject<number>;
  loadedSourceIdRef: MutableRefObject<string | null>;
  syncGenRef: MutableRefObject<number>;
  seekingRef: MutableRefObject<boolean>;
  skipClipSyncRef: MutableRefObject<boolean>;
};

export function useAudioPreview({
  clips,
  clipsRef,
  sourcesRef,
  playheadRef,
  setPlayhead,
  playing,
  playingRef,
  setPlaying,
  clipIndexRef,
  loadedSourceIdRef,
  syncGenRef,
  seekingRef,
  skipClipSyncRef,
}: AudioPreview) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const { audioCtxRef, gainNodeRef, mediaSourceRef } = useLiveGraph();

  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close().catch(() => undefined);
    };
  }, [audioCtxRef]);

  const connectGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    attachElementGraph(audio, { audioCtxRef, gainNodeRef, mediaSourceRef });
  }, [audioCtxRef, gainNodeRef, mediaSourceRef]);

  const applyLiveGain = useCallback(
    (clip: EditorClip | null, localMs: number) => {
      const value = clip ? envelopeAt(clip, localMs) : 1;
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = value;
        return;
      }
      const audio = audioRef.current;
      if (audio) audio.volume = Math.min(1, Math.max(0, value));
    },
    [gainNodeRef],
  );

  const showClip = useCallback(
    async (index: number, offsetMs: number, autoplay: boolean) => {
      const audio = audioRef.current;
      const clipsNow = clipsRef.current;
      const clip = clipsNow[index];
      if (!audio || !clip) return;
      const source = sourcesRef.current[clip.sourceId];
      if (!source) return;

      const gen = (syncGenRef.current += 1);
      seekingRef.current = true;
      clipIndexRef.current = index;
      const local = clamp(offsetMs, 0, clipDuration(clip));
      const target = (clip.inMs + local) / 1000;
      applyLiveGain(clip, local);

      try {
        await cueMediaClip({
          media: audio,
          sourceId: source.id,
          url: source.url,
          targetSeconds: target,
          autoplay,
          gen,
          syncGen: () => syncGenRef.current,
          loadedSourceIdRef,
          connectGraph,
          resume: () => void audioCtxRef.current?.resume(),
        });
      } finally {
        if (gen === syncGenRef.current) seekingRef.current = false;
      }
    },
    [
      applyLiveGain,
      audioCtxRef,
      clipIndexRef,
      clipsRef,
      connectGraph,
      loadedSourceIdRef,
      seekingRef,
      sourcesRef,
      syncGenRef,
    ],
  );

  const syncToPlayhead = useCallback(
    async (ms: number, autoplay: boolean) => {
      const hit = locateClip(clipsRef.current, ms);
      if (!hit) return;
      await showClip(hit.index, hit.offsetMs, autoplay);
    },
    [clipsRef, showClip],
  );

  const seek = useCallback(
    (ms: number) => {
      const next = setPlayhead(ms);
      const hit = locateClip(clipsRef.current, next);
      if (hit) {
        clipIndexRef.current = hit.index;
        applyLiveGain(hit.clip, hit.offsetMs);
      }
      void syncToPlayhead(next, playingRef.current);
      return next;
    },
    [applyLiveGain, clipIndexRef, clipsRef, playingRef, setPlayhead, syncToPlayhead],
  );

  const queueScrub = usePlayheadScrub(syncToPlayhead);

  useEffect(() => {
    if (playing) return;
    audioRef.current?.pause();
  }, [playing]);

  useEffect(() => {
    if (!clips.length) {
      clearMediaElement(audioRef.current);
      loadedSourceIdRef.current = null;
      if (playheadRef.current !== 0) setPlayhead(0);
      return;
    }
    const total = totalDuration(clips);
    if (playheadRef.current > total) setPlayhead(total);
    const hit = locateClip(clips, playheadRef.current);
    if (hit) {
      clipIndexRef.current = hit.index;
      applyLiveGain(hit.clip, hit.offsetMs);
    }
    if (skipClipSyncRef.current) return;
    if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
  }, [
    applyLiveGain,
    clipIndexRef,
    clips,
    loadedSourceIdRef,
    playheadRef,
    playingRef,
    setPlayhead,
    skipClipSyncRef,
    syncToPlayhead,
  ]);

  const goToNextClip = useCallback(
    (keepPlaying: () => void) => {
      const audio = audioRef.current;
      const clipsNow = clipsRef.current;
      const index = clipIndexRef.current;
      const prev = clipsNow[index];
      const nextClip = clipsNow[index + 1];
      if (!prev || !nextClip) {
        playingRef.current = false;
        setPlaying(false);
        setPlayhead(totalDuration(clipsNow));
        audio?.pause();
        return;
      }

      clipIndexRef.current = index + 1;
      setPlayhead(clipStartMs(clipsNow, index + 1));
      applyLiveGain(nextClip, 0);

      if (
        audio &&
        sameSourceCutContinues(prev, nextClip, loadedSourceIdRef.current, audio.currentTime * 1000)
      ) {
        keepPlaying();
        return;
      }

      void showClip(index + 1, 0, true);
    },
    [applyLiveGain, clipIndexRef, clipsRef, loadedSourceIdRef, playingRef, setPlayhead, setPlaying, showClip],
  );

  usePlaybackClock({
    playing,
    mediaRef: audioRef,
    seekingRef,
    playingRef,
    audioCtxRef,
    onPlay: async () => {
      const hit = locateClip(clipsRef.current, playheadRef.current);
      await (hit ? showClip(hit.index, hit.offsetMs, true) : Promise.resolve());
    },
    onTick: ({ keepPlaying }) => {
      const audio = audioRef.current;
      if (!audio || seekingRef.current) return true;
      const clipsNow = clipsRef.current;
      const index = clipIndexRef.current;
      const clip = clipsNow[index];
      if (!clip) {
        setPlaying(false);
        return false;
      }
      const sourceTime = audio.currentTime * 1000;
      if (sourceTime >= clip.outMs || audio.ended) {
        goToNextClip(keepPlaying);
      } else {
        const next = playheadFromClipTime(clipsNow, index, sourceTime);
        if (next != null) {
          setPlayhead(next);
          applyLiveGain(clip, sourceTime - clip.inMs);
          keepPlaying();
        }
      }
      return true;
    },
    onEnded: () => {
      const audio = audioRef.current;
      goToNextClip(() => {
        if (playingRef.current && audio?.paused && !seekingRef.current) {
          void audio.play().catch(() => undefined);
        }
      });
    },
  });

  const togglePlay = useCallback(() => {
    if (!clipsRef.current.length) return;
    if (playheadRef.current >= totalDuration(clipsRef.current) - 250) {
      setPlayhead(0);
      clipIndexRef.current = 0;
    }
    connectGraph();
    void audioCtxRef.current?.resume();
    setPlaying((value) => !value);
  }, [audioCtxRef, clipIndexRef, clipsRef, connectGraph, playheadRef, setPlayhead, setPlaying]);

  return {
    audioRef,
    connectGraph,
    applyLiveGain,
    showClip,
    syncToPlayhead,
    seek,
    queueScrub,
    togglePlay,
  };
}
