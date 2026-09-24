import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { EditorClip } from "../types";
import { envelopeAt } from "./audioGain";
import {
  applyExtraAudioElement,
  attachElementGraph,
  clearMediaElement,
  cueMediaClip,
  extraAudioAtPlayhead,
  playheadFromClipTime,
  sameSourceCutContinues,
} from "./editorPlayback";
import {
  audioTrackClips,
  clamp,
  clipDuration,
  clipStartMs,
  hasDetachedAudio,
  isAudioClip,
  isPastPicture,
  isVideoClip,
  locateClip,
  timelineDuration,
  totalDuration,
  videoTrackClips,
} from "./timelineMath";
import { useLiveGraph } from "./useLiveGraph";
import { usePlaybackClock } from "./usePlaybackClock";
import { usePlayheadScrub } from "./usePlayheadScrub";

type PreviewSource = { id: string; url: string };

type VideoPreview = {
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

export function useVideoPreview({
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
}: VideoPreview) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { audioCtxRef, gainNodeRef, mediaSourceRef } = useLiveGraph();
  const [blankPicture, setBlankPicture] = useState(false);
  const blankPictureRef = useRef(false);
  const extraAudioEls = useRef(new Map<string, HTMLAudioElement>());
  const extraGainNodes = useRef(new Map<string, GainNode>());
  const extraConnected = useRef(new Set<string>());
  const extraAudio = useMemo(() => audioTrackClips(clips), [clips]);

  useEffect(() => {
    return () => {
      void audioCtxRef.current?.close().catch(() => undefined);
    };
  }, [audioCtxRef]);

  useEffect(() => {
    if (playing) return;
    videoRef.current?.pause();
    extraAudioEls.current.forEach((el) => el.pause());
  }, [playing]);

  const connectGraph = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (audioCtxRef.current?.state === "closed") {
      audioCtxRef.current = null;
      mediaSourceRef.current = null;
      gainNodeRef.current = null;
      extraConnected.current.clear();
      extraGainNodes.current.clear();
    }
    attachElementGraph(
      video,
      { audioCtxRef, gainNodeRef, mediaSourceRef },
      { initialGain: 0, resume: true },
    );
  }, [audioCtxRef, gainNodeRef, mediaSourceRef]);

  const applyLiveGain = useCallback(
    (clip: EditorClip | null, localMs: number) => {
      const detached = clip != null && hasDetachedAudio(clipsRef.current, clip.id);
      const value = !clip || detached ? 0 : envelopeAt(clip, localMs);
      const video = videoRef.current;
      if (video) {
        video.muted = value <= 0;
        video.volume = Math.min(1, Math.max(0, value));
      }
      if (gainNodeRef.current) gainNodeRef.current.gain.value = value;
    },
    [clipsRef, gainNodeRef],
  );

  const connectExtra = useCallback(
    (id: string, el: HTMLAudioElement) => {
      connectGraph();
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state === "closed" || extraConnected.current.has(id)) return;
      try {
        const gain = ctx.createGain();
        const source = ctx.createMediaElementSource(el);
        source.connect(gain);
        gain.connect(ctx.destination);
        extraGainNodes.current.set(id, gain);
        extraConnected.current.add(id);
        void ctx.resume();
      } catch {
        extraGainNodes.current.delete(id);
      }
    },
    [audioCtxRef, connectGraph],
  );

  const syncExtraAudio = useCallback(
    (ms: number, autoplay: boolean) => {
      const clipsNow = clipsRef.current;
      extraAudioEls.current.forEach((el, id) => {
        const clip = clipsNow.find((item) => item.id === id);
        if (!clip || !isAudioClip(clip)) {
          el.pause();
          return;
        }
        const source = sourcesRef.current[clip.sourceId];
        if (!source) {
          el.pause();
          return;
        }
        connectExtra(id, el);
        applyExtraAudioElement(
          el,
          extraAudioAtPlayhead(clip, ms),
          source,
          extraGainNodes.current.get(id),
          autoplay,
        );
      });
    },
    [clipsRef, connectExtra, sourcesRef],
  );

  const showClip = useCallback(
    async (index: number, offsetMs: number, autoplay: boolean) => {
      const video = videoRef.current;
      const clipsNow = clipsRef.current;
      const clip = clipsNow[index];
      if (!video || !clip || isAudioClip(clip)) return;
      const source = sourcesRef.current[clip.sourceId];
      if (!source) return;

      const gen = (syncGenRef.current += 1);
      seekingRef.current = true;
      clipIndexRef.current = index;
      blankPictureRef.current = false;
      setBlankPicture(false);
      const local = clamp(offsetMs, 0, clipDuration(clip));
      const target = (clip.inMs + local) / 1000;

      try {
        await cueMediaClip({
          media: video,
          sourceId: source.id,
          url: source.url,
          targetSeconds: target,
          autoplay,
          gen,
          syncGen: () => syncGenRef.current,
          loadedSourceIdRef,
          connectGraph,
          afterConnect: () => applyLiveGain(clip, local),
          resume: () => void audioCtxRef.current?.resume(),
        });
      } finally {
        if (gen === syncGenRef.current) seekingRef.current = false;
      }
    },
    [applyLiveGain, audioCtxRef, clipIndexRef, clipsRef, connectGraph, loadedSourceIdRef, seekingRef, sourcesRef, syncGenRef],
  );

  const showBlankFrame = useCallback(() => {
    videoRef.current?.pause();
    applyLiveGain(null, 0);
    if (blankPictureRef.current) return;
    syncGenRef.current += 1;
    seekingRef.current = false;
    blankPictureRef.current = true;
    setBlankPicture(true);
  }, [applyLiveGain, syncGenRef, seekingRef]);

  const syncToPlayhead = useCallback(
    async (ms: number, autoplay: boolean) => {
      syncExtraAudio(ms, autoplay);
      if (isPastPicture(clipsRef.current, ms)) {
        showBlankFrame();
        return;
      }
      const hit = locateClip(clipsRef.current, ms);
      if (!hit) {
        showBlankFrame();
        return;
      }
      await showClip(hit.index, hit.offsetMs, autoplay);
    },
    [clipsRef, showBlankFrame, showClip, syncExtraAudio],
  );

  const seek = useCallback(
    (ms: number) => {
      const next = setPlayhead(ms);
      const hit = locateClip(clipsRef.current, next);
      if (hit && !isPastPicture(clipsRef.current, next)) {
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
    if (!clips.length) {
      clearMediaElement(videoRef.current);
      loadedSourceIdRef.current = null;
      blankPictureRef.current = false;
      setBlankPicture(false);
      if (playheadRef.current !== 0) setPlayhead(0);
      return;
    }
    const total = timelineDuration(clips);
    if (playheadRef.current > total) setPlayhead(total);
    const hit = locateClip(clips, playheadRef.current);
    if (hit) clipIndexRef.current = hit.index;
    if (hit) applyLiveGain(hit.clip, hit.offsetMs);
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
      const video = videoRef.current;
      const clipsNow = clipsRef.current;
      const current = clipsNow[clipIndexRef.current];
      const videoClipsNow = videoTrackClips(clipsNow);
      const videoIndex = current ? videoClipsNow.findIndex((item) => item.id === current.id) : -1;
      const nextClip = videoClipsNow[videoIndex + 1];
      if (!nextClip) {
        const picture = totalDuration(clipsNow);
        const timeline = timelineDuration(clipsNow);
        showBlankFrame();
        if (picture < timeline && playheadRef.current < timeline - 30) {
          if (playheadRef.current < picture) setPlayhead(picture);
          syncExtraAudio(playheadRef.current, true);
          return;
        }
        playingRef.current = false;
        setPlaying(false);
        setPlayhead(timeline);
        extraAudioEls.current.forEach((el) => el.pause());
        return;
      }

      const nextIndex = clipsNow.findIndex((item) => item.id === nextClip.id);
      clipIndexRef.current = nextIndex;
      setPlayhead(clipStartMs(clipsNow, nextIndex));
      applyLiveGain(nextClip, 0);

      if (
        video &&
        sameSourceCutContinues(current, nextClip, loadedSourceIdRef.current, video.currentTime * 1000)
      ) {
        keepPlaying();
        return;
      }

      void showClip(nextIndex, 0, true);
    },
    [
      applyLiveGain,
      clipIndexRef,
      clipsRef,
      loadedSourceIdRef,
      playheadRef,
      playingRef,
      setPlayhead,
      setPlaying,
      showBlankFrame,
      showClip,
      syncExtraAudio,
    ],
  );

  usePlaybackClock({
    playing,
    mediaRef: videoRef,
    seekingRef,
    playingRef,
    audioCtxRef,
    onPlay: async () => {
      syncExtraAudio(playheadRef.current, true);
      const pastPicture = isPastPicture(clipsRef.current, playheadRef.current);
      if (pastPicture) showBlankFrame();
      const hit = pastPicture ? null : locateClip(clipsRef.current, playheadRef.current);
      await (hit ? showClip(hit.index, hit.offsetMs, true) : Promise.resolve());
      syncExtraAudio(playheadRef.current, true);
    },
    onTick: ({ dt, keepPlaying }) => {
      const video = videoRef.current;
      if (!video || seekingRef.current) return true;
      const clipsNow = clipsRef.current;
      const timeline = timelineDuration(clipsNow);
      const index = clipIndexRef.current;
      const clip = clipsNow[index];
      const inPicture = clip && isVideoClip(clip) && !isPastPicture(clipsNow, playheadRef.current);

      if (inPicture && clip) {
        const sourceTime = video.currentTime * 1000;
        if (sourceTime >= clip.outMs || video.ended) {
          goToNextClip(keepPlaying);
        } else {
          const next = playheadFromClipTime(clipsNow, index, sourceTime);
          if (next != null) {
            setPlayhead(next);
            applyLiveGain(clip, sourceTime - clip.inMs);
            syncExtraAudio(next, true);
            keepPlaying();
          }
        }
      } else {
        showBlankFrame();
        const next = Math.min(timeline, playheadRef.current + dt);
        setPlayhead(next);
        syncExtraAudio(next, true);
        if (next >= timeline - 10) {
          playingRef.current = false;
          setPlaying(false);
          extraAudioEls.current.forEach((el) => el.pause());
          return false;
        }
      }
      return true;
    },
    onEnded: () => {
      const video = videoRef.current;
      goToNextClip(() => {
        if (playingRef.current && video?.paused && !seekingRef.current) {
          void video.play().catch(() => undefined);
        }
      });
    },
  });

  const togglePlay = useCallback(() => {
    if (!clipsRef.current.length) return;
    if (playheadRef.current >= timelineDuration(clipsRef.current) - 250) {
      setPlayhead(0);
      const first = videoTrackClips(clipsRef.current)[0];
      clipIndexRef.current = first
        ? clipsRef.current.findIndex((item) => item.id === first.id)
        : 0;
    }
    connectGraph();
    void audioCtxRef.current?.resume();
    if (!playingRef.current) syncExtraAudio(playheadRef.current, true);
    setPlaying((value) => !value);
  }, [audioCtxRef, clipIndexRef, clipsRef, connectGraph, playheadRef, playingRef, setPlayhead, setPlaying, syncExtraAudio]);

  return {
    videoRef,
    extraAudioEls,
    extraAudio,
    blankPicture,
    connectGraph,
    applyLiveGain,
    syncExtraAudio,
    showClip,
    showBlankFrame,
    syncToPlayhead,
    seek,
    queueScrub,
    togglePlay,
  };
}
