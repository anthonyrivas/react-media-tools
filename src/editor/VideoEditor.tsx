import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EditorClip, EditorInput, ExportResult } from "../types";
import { downloadBlob, formatPrecise, uid } from "../utils";
import { exportTimeline } from "./exportTimeline";
import { cloneSnapshot, createHistory, sameClips, type EditorSnapshot } from "./history";
import { extractThumbnail, looksLikeAudioFile, probeMedia } from "./probe";
import { Timeline, type TimelineHandle, type TimelineSource } from "./Timeline";
import { IconButton } from "../IconButton";
import {
  IconDownload,
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
import { extractPeaks } from "./waveform";
import {
  MAX_GAIN,
  envelopeAt,
  normalizedVolume,
  withClampedAudio,
} from "./audioGain";
import { measureClipPeak } from "./exportAudio";
import {
  FRAME_MS,
  MIN_CLIP_MS,
  SKIP_MS,
  audioClipEnd,
  audioClipStart,
  audioClipsAt,
  audioTrackClips,
  clamp,
  clipDuration,
  clipHasPlayableAudio,
  clipStartMs,
  hasDetachedAudio,
  isAudioClip,
  isVideoClip,
  locateClip,
  timelineDuration,
  totalDuration,
  videoTrackClips,
} from "./timelineMath";

export type VideoEditorHandle = {
  addSource: (input: EditorInput | Blob, name?: string) => Promise<void>;
  split: (allTracks?: boolean) => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  exportVideo: () => Promise<ExportResult | null>;
  download: (filename?: string) => void;
  normalizeSelected: () => Promise<void>;
  unlinkSelected: () => void;
};

export type VideoEditorProps = {
  className?: string;
  style?: React.CSSProperties;
  sources?: EditorInput[];
  /** Shows an Open file control. Off by default; hosts can also call `addSource`. */
  showOpenFile?: boolean;
  /** Shows a Download control after export. Off by default; use `onExport` or `download()`. */
  showDownload?: boolean;
  /** Label for the encode button. Progress is appended as a percent. */
  exportLabel?: string;
  /** Label for the optional Download control. */
  downloadLabel?: string;
  onExport?: (result: ExportResult) => void;
  onChange?: (clips: EditorClip[]) => void;
  onError?: (error: Error) => void;
};

type LoadedSource = TimelineSource & {
  file: Blob;
  url: string;
  width: number;
  height: number;
  hasAudio: boolean;
};

export const VideoEditor = forwardRef<VideoEditorHandle, VideoEditorProps>(
  function VideoEditor(
    {
      className,
      style,
      sources: incoming,
      showOpenFile = false,
      showDownload = false,
      exportLabel = "Export",
      downloadLabel = "Download",
      onExport,
      onChange,
      onError,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const knownIds = useRef(new Set<string>());
    const playheadRef = useRef(0);
    const clipIndexRef = useRef(0);
    const loadedSourceIdRef = useRef<string | null>(null);
    const syncGenRef = useRef(0);
    const seekingRef = useRef(false);
    const playingRef = useRef(false);
    const clipsRef = useRef<EditorClip[]>([]);
    const sourcesRef = useRef<Record<string, LoadedSource>>({});
    const [sourceMap, setSourceMap] = useState<Record<string, LoadedSource>>({});
    const [clips, setClips] = useState<EditorClip[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [lastExport, setLastExport] = useState<ExportResult | null>(null);
    const [clipThumbs, setClipThumbs] = useState<Record<string, string>>({});
    const fileRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<TimelineHandle>(null);
    const skipClipSyncRef = useRef(false);
    const scrubRaf = useRef(0);
    const pendingScrub = useRef<number | null>(null);
    const thumbsRef = useRef(clipThumbs);
    const [fileHover, setFileHover] = useState(false);
    const dragDepth = useRef(0);
    const selectedIdRef = useRef<string | null>(null);
    const editorActiveRef = useRef(false);
    const historyRef = useRef(createHistory());
    const trimBeforeRef = useRef<EditorSnapshot | null>(null);
    const fadeBeforeRef = useRef<EditorSnapshot | null>(null);
    const gainBeforeRef = useRef<EditorSnapshot | null>(null);
    const applyingHistoryRef = useRef(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const gainNodeRef = useRef<GainNode | null>(null);
    const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    const extraAudioEls = useRef(new Map<string, HTMLAudioElement>());
    const extraGainNodes = useRef(new Map<string, GainNode>());
    const extraConnected = useRef(new Set<string>());
    const moveBeforeRef = useRef<EditorSnapshot | null>(null);

    clipsRef.current = clips;
    sourcesRef.current = sourceMap;
    playingRef.current = playing;
    thumbsRef.current = clipThumbs;
    selectedIdRef.current = selectedId;

    const totalMs = useMemo(() => timelineDuration(clips), [clips]);
    const extraAudio = useMemo(() => audioTrackClips(clips), [clips]);
    const pictureClips = useMemo(() => videoTrackClips(clips), [clips]);

    const report = useCallback(
      (err: unknown) => {
        const next = err instanceof Error ? err : new Error(String(err));
        setError(next.message);
        onError?.(next);
      },
      [onError],
    );

    const setPlayhead = useCallback((ms: number) => {
      const next = clamp(ms, 0, Math.max(0, timelineDuration(clipsRef.current)));
      playheadRef.current = next;
      setPlayheadMs(next);
      return next;
    }, []);

    const captureState = useCallback(
      (): EditorSnapshot =>
        cloneSnapshot({
          clips: clipsRef.current,
          selectedId: selectedIdRef.current,
          playheadMs: playheadRef.current,
        }),
      [],
    );

    const syncHistoryButtons = useCallback(() => {
      setCanUndo(historyRef.current.canUndo);
      setCanRedo(historyRef.current.canRedo);
    }, []);

    const recordHistory = useCallback(() => {
      if (applyingHistoryRef.current) return;
      historyRef.current.push(captureState());
      syncHistoryButtons();
    }, [captureState, syncHistoryButtons]);

    const commitCoalesced = useCallback(
      (beforeRef: React.MutableRefObject<EditorSnapshot | null>) => {
        const before = beforeRef.current;
        beforeRef.current = null;
        if (before && !sameClips(before.clips, clipsRef.current)) {
          historyRef.current.push(before);
          syncHistoryButtons();
        }
      },
      [syncHistoryButtons],
    );

    const rememberThumb = useCallback((clipId: string, url?: string) => {
      if (!url) return;
      setClipThumbs((current) => {
        const prev = current[clipId];
        if (prev && prev !== url && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return { ...current, [clipId]: url };
      });
    }, []);

    const captureThumb = useCallback(
      async (clip: EditorClip, file?: Blob) => {
        const blob = file ?? sourcesRef.current[clip.sourceId]?.file;
        if (!blob) return;
        const url = await extractThumbnail(blob, clip.inMs + 80);
        rememberThumb(clip.id, url);
      },
      [rememberThumb],
    );

    const applySnapshot = useCallback(
      (snapshot: EditorSnapshot) => {
        applyingHistoryRef.current = true;
        const clipsNext = snapshot.clips.map((clip) => ({ ...clip }));
        clipsRef.current = clipsNext;
        setClips(clipsNext);
        selectedIdRef.current = snapshot.selectedId;
        setSelectedId(snapshot.selectedId);
        setPlayhead(snapshot.playheadMs);
        onChange?.(clipsNext);
        const keep = new Set(clipsNext.map((clip) => clip.id));
        setClipThumbs((current) => {
          const next = { ...current };
          Object.keys(next).forEach((id) => {
            if (keep.has(id)) return;
            const url = next[id];
            if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
            delete next[id];
          });
          return next;
        });
        clipsNext.forEach((clip) => {
          if (!thumbsRef.current[clip.id]) void captureThumb(clip);
        });
        applyingHistoryRef.current = false;
      },
      [captureThumb, onChange, setPlayhead],
    );

    const undo = useCallback(() => {
      const previous = historyRef.current.undo(captureState());
      if (!previous) return;
      applySnapshot(previous);
      syncHistoryButtons();
    }, [applySnapshot, captureState, syncHistoryButtons]);

    const redo = useCallback(() => {
      const next = historyRef.current.redo(captureState());
      if (!next) return;
      applySnapshot(next);
      syncHistoryButtons();
    }, [applySnapshot, captureState, syncHistoryButtons]);

    const appendClip = useCallback(
      (sourceId: string, durationMs: number, file: Blob) => {
        recordHistory();
        const clip = withClampedAudio({
          id: uid("clip"),
          sourceId,
          inMs: 0,
          outMs: durationMs,
        });
        const start = totalDuration(clipsRef.current);
        setClips((current) => {
          const next = [...current, clip];
          onChange?.(next);
          return next;
        });
        setSelectedId(clip.id);
        setPlayhead(start);
        clipIndexRef.current = clipsRef.current.length;
        void captureThumb(clip, file);
      },
      [captureThumb, onChange, recordHistory, setPlayhead],
    );

    const appendAudioClip = useCallback(
      (sourceId: string, durationMs: number) => {
        recordHistory();
        const clip = withClampedAudio({
          id: uid("clip"),
          sourceId,
          inMs: 0,
          outMs: durationMs,
          kind: "audio",
          startMs: playheadRef.current,
        });
        setClips((current) => {
          const next = [...current, clip];
          onChange?.(next);
          return next;
        });
        setSelectedId(clip.id);
      },
      [onChange, recordHistory],
    );

    const addSource = useCallback(
      async (input: EditorInput | Blob, name?: string) => {
        const item: EditorInput = input instanceof Blob ? { file: input, name } : input;
        const id = item.id ?? sourceIdFor(item.file);
        const existing = sourcesRef.current[id];
        if (existing) {
          if (!existing.width && !existing.height) appendAudioClip(existing.id, existing.durationMs);
          else appendClip(existing.id, existing.durationMs, existing.file);
          return;
        }
        if (knownIds.current.has(id)) return;
        knownIds.current.add(id);
        setBusy(true);
        setError(null);
        try {
          const probed = await probeMedia(item.file, {
            durationMs: item.durationMs,
            width: item.width,
            height: item.height,
          });
          const durationMs = positiveMs(item.durationMs) ?? positiveMs(probed.durationMs) ?? 0;
          const audioOnly = looksLikeAudioFile(item.file) || !probed.hasVideo;
          if (durationMs <= 0) {
            throw new Error(
              audioOnly
                ? "Could not read this audio. Try another file, or record again."
                : "Could not read this video. Try another file, or record again.",
            );
          }
          const url = URL.createObjectURL(item.file);
          const loaded: LoadedSource = {
            id,
            file: item.file,
            url,
            name: item.name ?? name ?? `Clip ${Object.keys(sourcesRef.current).length + 1}`,
            durationMs,
            width: audioOnly ? 0 : item.width || probed.width || 1280,
            height: audioOnly ? 0 : item.height || probed.height || 720,
            hasAudio: audioOnly || probed.hasAudio,
          };
          setSourceMap((current) => ({ ...current, [id]: loaded }));
          if (audioOnly) appendAudioClip(id, durationMs);
          else appendClip(id, durationMs, item.file);
          void extractPeaks(item.file).then((peaks) => {
            if (!peaks) return;
            setSourceMap((current) => {
              const src = current[id];
              if (!src) return current;
              return { ...current, [id]: { ...src, peaks } };
            });
          });
        } catch (err) {
          knownIds.current.delete(id);
          report(err);
          throw err instanceof Error ? err : new Error(String(err));
        } finally {
          setBusy(false);
        }
      },
      [appendAudioClip, appendClip, report],
    );

    useEffect(() => {
      incoming?.forEach((item) => {
        void addSource(item).catch(() => undefined);
      });
    }, [addSource, incoming]);

    useEffect(() => {
      return () => {
        if (scrubRaf.current) cancelAnimationFrame(scrubRaf.current);
        Object.values(thumbsRef.current).forEach((url) => {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        });
        void audioCtxRef.current?.close().catch(() => undefined);
      };
    }, []);

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
      if (mediaSourceRef.current) {
        void audioCtxRef.current?.resume();
        return;
      }
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      try {
        const ctx = new AudioCtx();
        const gain = ctx.createGain();
        const source = ctx.createMediaElementSource(video);
        source.connect(gain);
        gain.connect(ctx.destination);
        audioCtxRef.current = ctx;
        gainNodeRef.current = gain;
        mediaSourceRef.current = source;
        gain.gain.value = 0;
        void ctx.resume();
      } catch {
        mediaSourceRef.current = null;
      }
    }, []);

    const applyLiveGain = useCallback((clip: EditorClip | null, localMs: number) => {
      const detached = clip != null && hasDetachedAudio(clipsRef.current, clip.id);
      const value = !clip || detached ? 0 : envelopeAt(clip, localMs);
      const video = videoRef.current;
      if (video) {
        video.muted = value <= 0;
        video.volume = Math.min(1, Math.max(0, value));
      }
      if (gainNodeRef.current) gainNodeRef.current.gain.value = value;
    }, []);

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
      [connectGraph],
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
          const start = audioClipStart(clip);
          const end = audioClipEnd(clip);
          const inRange = ms >= start && ms < end;
          const local = clamp(ms - start, 0, clipDuration(clip));
          const gain = inRange ? envelopeAt(clip, local) : 0;
          const gainNode = extraGainNodes.current.get(id);
          el.muted = false;
          if (gainNode) gainNode.gain.value = gain;
          else el.volume = Math.min(1, Math.max(0, gain));
          if (el.dataset.sourceId !== source.id) {
            el.src = source.url;
            el.dataset.sourceId = source.id;
          }
          if (!inRange || gain <= 0) {
            if (!el.paused) el.pause();
            return;
          }
          const target = (clip.inMs + local) / 1000;
          if (Math.abs(el.currentTime - target) > 0.08) el.currentTime = target;
          if (autoplay) {
            if (el.paused) void el.play().catch(() => undefined);
          } else if (!el.paused) {
            el.pause();
          }
        });
      },
      [connectExtra],
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
        const local = clamp(offsetMs, 0, clipDuration(clip));
        const target = (clip.inMs + local) / 1000;

        try {
          connectGraph();
          applyLiveGain(clip, local);
          if (autoplay) void audioCtxRef.current?.resume();
          if (loadedSourceIdRef.current !== source.id) {
            video.src = source.url;
            loadedSourceIdRef.current = source.id;
            await wait(video, "loadeddata", 5000);
          }
          if (gen !== syncGenRef.current) return;
          if (Math.abs(video.currentTime - target) > 0.08) {
            await seekTo(video, target);
          }
          if (gen !== syncGenRef.current) return;
          if (autoplay) {
            if (video.paused) await video.play();
          } else {
            video.pause();
          }
        } catch {
          if (gen === syncGenRef.current && !autoplay) video.pause();
        } finally {
          if (gen === syncGenRef.current) seekingRef.current = false;
        }
      },
      [applyLiveGain, connectGraph],
    );

    const syncToPlayhead = useCallback(
      async (ms: number, autoplay: boolean) => {
        syncExtraAudio(ms, autoplay);
        const hit = locateClip(clipsRef.current, ms);
        if (!hit) {
          videoRef.current?.pause();
          return;
        }
        await showClip(hit.index, hit.offsetMs, autoplay);
      },
      [showClip, syncExtraAudio],
    );

    const seek = useCallback(
      (ms: number) => {
        const next = setPlayhead(ms);
        const hit = locateClip(clipsRef.current, next);
        if (hit) clipIndexRef.current = hit.index;
        if (hit) applyLiveGain(hit.clip, hit.offsetMs);
        void syncToPlayhead(next, playingRef.current);
        return next;
      },
      [applyLiveGain, setPlayhead, syncToPlayhead],
    );

    useEffect(() => {
      if (!clips.length) {
        const video = videoRef.current;
        if (video) {
          video.pause();
          video.removeAttribute("src");
          video.load();
        }
        loadedSourceIdRef.current = null;
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
    }, [applyLiveGain, clips, setPlayhead, syncToPlayhead]);

    useEffect(() => {
      if (!playing) return;
      const video = videoRef.current;
      if (!video) return;
      let raf = 0;
      let active = true;
      let last = performance.now();

      const keepPlaying = () => {
        if (active && playingRef.current && video.paused && !seekingRef.current) {
          void video.play().catch(() => undefined);
        }
      };

      const goToNextClip = () => {
        const clipsNow = clipsRef.current;
        const current = clipsNow[clipIndexRef.current];
        const videoClipsNow = videoTrackClips(clipsNow);
        const videoIndex = current ? videoClipsNow.findIndex((item) => item.id === current.id) : -1;
        const nextClip = videoClipsNow[videoIndex + 1];
        if (!nextClip) {
          const picture = totalDuration(clipsNow);
          const timeline = timelineDuration(clipsNow);
          video.pause();
          applyLiveGain(null, 0);
          if (picture < timeline && playheadRef.current < timeline - 30) {
            setPlayhead(Math.max(playheadRef.current, picture));
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

        const timeMs = video.currentTime * 1000;
        const sameSource =
          current?.sourceId === nextClip.sourceId && loadedSourceIdRef.current === nextClip.sourceId;
        const stillInNext = timeMs < nextClip.outMs;
        const nearNextIn = nextClip.inMs - timeMs < 500;

        // Split or other continuous cut on the same file: do not pause or seek.
        if (current && sameSource && stillInNext && nearNextIn) {
          keepPlaying();
          return;
        }

        void showClip(nextIndex, 0, true);
      };

      const tick = (now: number) => {
        if (!active) return;
        const dt = now - last;
        last = now;
        if (!seekingRef.current) {
          const clipsNow = clipsRef.current;
          const timeline = timelineDuration(clipsNow);
          const picture = totalDuration(clipsNow);
          const index = clipIndexRef.current;
          const clip = clipsNow[index];
          const inPicture =
            clip && isVideoClip(clip) && playheadRef.current < picture && picture > 0;

          if (inPicture && clip) {
            const sourceTime = video.currentTime * 1000;
            if (sourceTime >= clip.outMs || video.ended) {
              goToNextClip();
            } else if (sourceTime >= clip.inMs) {
              const local = sourceTime - clip.inMs;
              const next = clipStartMs(clipsNow, index) + local;
              setPlayhead(next);
              applyLiveGain(clip, local);
              syncExtraAudio(next, true);
              keepPlaying();
            }
          } else {
            video.pause();
            applyLiveGain(null, 0);
            const next = Math.min(timeline, playheadRef.current + dt);
            setPlayhead(next);
            syncExtraAudio(next, true);
            if (next >= timeline - 10) {
              playingRef.current = false;
              setPlaying(false);
              extraAudioEls.current.forEach((el) => el.pause());
              return;
            }
          }
        }
        raf = requestAnimationFrame(tick);
      };

      const onEnded = () => {
        if (active) goToNextClip();
      };

      video.addEventListener("ended", onEnded);
      void audioCtxRef.current?.resume();
      syncExtraAudio(playheadRef.current, true);

      const hit = locateClip(clipsRef.current, playheadRef.current);
      void (hit ? showClip(hit.index, hit.offsetMs, true) : Promise.resolve()).then(() => {
        if (!active) return;
        syncExtraAudio(playheadRef.current, true);
        raf = requestAnimationFrame(tick);
      });

      return () => {
        active = false;
        cancelAnimationFrame(raf);
        video.removeEventListener("ended", onEnded);
      };
    }, [applyLiveGain, playing, setPlayhead, showClip, syncExtraAudio]);

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
    }, [connectGraph, setPlayhead, syncExtraAudio]);

    const handleTrim = useCallback(
      (id: string, inMs: number, outMs: number, edge: "in" | "out") => {
        if (!trimBeforeRef.current) trimBeforeRef.current = captureState();
        skipClipSyncRef.current = true;
        const next = clipsRef.current.map((clip) =>
          clip.id === id ? withClampedAudio({ ...clip, inMs, outMs }) : clip,
        );
        clipsRef.current = next;
        setClips(next);
        onChange?.(next);
        const index = next.findIndex((clip) => clip.id === id);
        if (index < 0) return;
        const clip = next[index];
        const start = clipStartMs(next, index);
        const duration = Math.max(0, outMs - inMs);
        const playhead = edge === "in" ? start : start + duration;
        setPlayhead(playhead);
        if (!clip || isAudioClip(clip)) {
          syncExtraAudio(playhead, false);
          return;
        }
        clipIndexRef.current = index;
        void showClip(index, edge === "in" ? 0 : Math.max(0, duration - 40), false);
      },
      [captureState, onChange, setPlayhead, showClip, syncExtraAudio],
    );

    const handleTrimEnd = useCallback(() => {
      commitCoalesced(trimBeforeRef);
      skipClipSyncRef.current = false;
      const hit = locateClip(clipsRef.current, playheadRef.current);
      if (hit && isVideoClip(hit.clip)) void captureThumb(hit.clip);
      if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
    }, [captureThumb, commitCoalesced, syncToPlayhead]);

    const patchClip = useCallback(
      (id: string, patch: Partial<EditorClip>) => {
        const next = clipsRef.current.map((clip) =>
          clip.id === id ? withClampedAudio({ ...clip, ...patch }) : clip,
        );
        clipsRef.current = next;
        setClips(next);
        onChange?.(next);
        const hit = locateClip(next, playheadRef.current);
        if (hit) applyLiveGain(hit.clip, hit.offsetMs);
        syncExtraAudio(playheadRef.current, playingRef.current);
      },
      [applyLiveGain, onChange, syncExtraAudio],
    );

    const handleFade = useCallback(
      (id: string, fadeInMs: number, fadeOutMs: number) => {
        if (!fadeBeforeRef.current) fadeBeforeRef.current = captureState();
        patchClip(id, { fadeInMs, fadeOutMs });
      },
      [captureState, patchClip],
    );

    const handleFadeEnd = useCallback(() => {
      commitCoalesced(fadeBeforeRef);
    }, [commitCoalesced]);

    const handleGainInput = useCallback(
      (percent: number) => {
        const id = selectedIdRef.current;
        const clip = clipsRef.current.find((item) => item.id === id);
        if (!clip) return;
        const source = sourcesRef.current[clip.sourceId];
        if (!clipHasPlayableAudio(clipsRef.current, clip, source?.hasAudio !== false)) return;
        if (!gainBeforeRef.current) gainBeforeRef.current = captureState();
        patchClip(clip.id, { volume: clamp(percent / 100, 0, MAX_GAIN), muted: false });
      },
      [captureState, patchClip],
    );

    const handleGainCommit = useCallback(() => {
      commitCoalesced(gainBeforeRef);
    }, [commitCoalesced]);

    const toggleMute = useCallback(() => {
      const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
      if (!clip) return;
      const source = sourcesRef.current[clip.sourceId];
      if (!clipHasPlayableAudio(clipsRef.current, clip, source?.hasAudio !== false)) return;
      recordHistory();
      patchClip(clip.id, { muted: !clip.muted });
    }, [patchClip, recordHistory]);

    const unlinkSelected = useCallback(() => {
      const clipsNow = clipsRef.current;
      const clip = clipsNow.find((item) => item.id === selectedIdRef.current);
      if (!clip || isAudioClip(clip)) return;
      if (clipsNow.some((item) => item.linkedClipId === clip.id)) return;
      if (sourcesRef.current[clip.sourceId]?.hasAudio === false) return;
      recordHistory();
      const index = clipsNow.findIndex((item) => item.id === clip.id);
      const audio = withClampedAudio({
        id: uid("clip"),
        sourceId: clip.sourceId,
        inMs: clip.inMs,
        outMs: clip.outMs,
        volume: clip.volume,
        fadeInMs: clip.fadeInMs,
        fadeOutMs: clip.fadeOutMs,
        kind: "audio",
        startMs: clipStartMs(clipsNow, index),
        linkedClipId: clip.id,
        muted: false,
      });
      const next = clipsNow
        .map((item) => (item.id === clip.id ? withClampedAudio({ ...item, muted: true }) : item))
        .concat(audio);
      clipsRef.current = next;
      setClips(next);
      onChange?.(next);
      setSelectedId(audio.id);
      connectGraph();
      applyLiveGain({ ...clip, muted: true }, 0);
      syncExtraAudio(playheadRef.current, playingRef.current);
    }, [applyLiveGain, connectGraph, onChange, recordHistory, syncExtraAudio]);

    const normalizeSelected = useCallback(async () => {
      const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
      const source = clip ? sourcesRef.current[clip.sourceId] : undefined;
      const file = source?.file;
      if (!clip || !file) return;
      if (!clipHasPlayableAudio(clipsRef.current, clip, source.hasAudio !== false)) return;
      setBusy(true);
      setError(null);
      try {
        const peak = await measureClipPeak(file, clip.inMs, clip.outMs);
        if (!(peak > 0)) throw new Error("Could not measure this clip for normalize.");
        recordHistory();
        patchClip(clip.id, { volume: normalizedVolume(peak), muted: false });
      } catch (err) {
        report(err);
      } finally {
        setBusy(false);
      }
    }, [patchClip, recordHistory, report]);

    const handleScrub = useCallback(
      (ms: number) => {
        playingRef.current = false;
        setPlaying(false);
        const next = setPlayhead(ms);
        const hit = locateClip(clipsRef.current, next);
        if (hit) {
          clipIndexRef.current = hit.index;
          setSelectedId(hit.clip.id);
          applyLiveGain(hit.clip, hit.offsetMs);
        }
        pendingScrub.current = next;
        if (scrubRaf.current) return;
        scrubRaf.current = requestAnimationFrame(() => {
          scrubRaf.current = 0;
          const time = pendingScrub.current;
          if (time != null) void syncToPlayhead(time, false);
        });
      },
      [applyLiveGain, setPlayhead, syncToPlayhead],
    );

    const handleMoveAudio = useCallback(
      (id: string, startMs: number) => {
        if (!moveBeforeRef.current) moveBeforeRef.current = captureState();
        patchClip(id, { startMs: Math.max(0, startMs) });
      },
      [captureState, patchClip],
    );

    const handleMoveAudioEnd = useCallback(() => {
      commitCoalesced(moveBeforeRef);
    }, [commitCoalesced]);

    const handleReorder = useCallback(
      (from: number, to: number) => {
        if (from === to) return;
        recordHistory();
        setClips((current) => {
          const video = videoTrackClips(current);
          const audio = audioTrackClips(current);
          const next = video.slice();
          const [moved] = next.splice(from, 1);
          if (!moved) return current;
          next.splice(to, 0, moved);
          const combined = [...next, ...audio];
          onChange?.(combined);
          return combined;
        });
      },
      [onChange, recordHistory],
    );

    const handleSeek = useCallback(
      (ms: number) => {
        playingRef.current = false;
        setPlaying(false);
        const next = seek(ms);
        const selected = clipsRef.current.find((clip) => clip.id === selectedIdRef.current);
        if (selected && isAudioClip(selected)) return;
        const hit = locateClip(clipsRef.current, next);
        if (hit) setSelectedId(hit.clip.id);
      },
      [seek],
    );

    const split = useCallback(
      (allTracks = false) => {
        const clipsNow = clipsRef.current;
        const playhead = playheadRef.current;
        const replacements = new Map<string, { left: EditorClip; right: EditorClip }>();

        const takeVideo = () => {
          const hit = locateClip(clipsNow, playhead);
          if (!hit) return;
          const parts = splitVideoClip(hit.clip, hit.offsetMs);
          if (parts) replacements.set(hit.clip.id, { left: parts[0], right: parts[1] });
        };

        const takeAudio = (clip: EditorClip) => {
          const parts = splitAudioClip(clip, playhead);
          if (parts) replacements.set(clip.id, { left: parts[0], right: parts[1] });
        };

        if (allTracks) {
          takeVideo();
          audioClipsAt(clipsNow, playhead).forEach(takeAudio);
        } else {
          const selected = clipsNow.find((clip) => clip.id === selectedIdRef.current);
          if (selected && isAudioClip(selected)) takeAudio(selected);
          else takeVideo();
        }

        if (!replacements.size) return;
        recordHistory();

        for (const { left, right } of replacements.values()) {
          if (!isAudioClip(left) || !left.linkedClipId) continue;
          const parent = replacements.get(left.linkedClipId);
          if (!parent) continue;
          left.linkedClipId = parent.left.id;
          right.linkedClipId = parent.right.id;
        }

        const next: EditorClip[] = [];
        for (const clip of clipsNow) {
          const parts = replacements.get(clip.id);
          if (parts) next.push(parts.left, parts.right);
          else if (clip.linkedClipId && replacements.has(clip.linkedClipId)) {
            const parent = replacements.get(clip.linkedClipId);
            next.push(parent ? { ...clip, linkedClipId: parent.left.id } : clip);
          } else {
            next.push(clip);
          }
        }

        setClips(() => {
          onChange?.(next);
          return next;
        });

        const selectedParts = replacements.get(selectedIdRef.current ?? "");
        const videoHit = locateClip(clipsNow, playhead);
        const videoParts = videoHit ? replacements.get(videoHit.clip.id) : undefined;
        const nextSelected = selectedParts?.right ?? videoParts?.right;
        if (nextSelected) setSelectedId(nextSelected.id);
        if (videoParts) {
          clipIndexRef.current = next.findIndex((clip) => clip.id === videoParts.right.id);
          setClipThumbs((current) => {
            const inherited = current[videoHit?.clip.id ?? ""];
            const thumbsNext = { ...current };
            if (videoHit) delete thumbsNext[videoHit.clip.id];
            if (inherited) thumbsNext[videoParts.left.id] = inherited;
            return thumbsNext;
          });
          void captureThumb(videoParts.right);
        }
      },
      [captureThumb, onChange, recordHistory],
    );

    const deleteSelected = useCallback(() => {
      const id = selectedIdRef.current;
      if (!id) return;
      const current = clipsRef.current;
      const index = current.findIndex((clip) => clip.id === id);
      if (index < 0) return;
      recordHistory();
      const nextClips = current.filter((clip) => clip.id !== id);
      const neighbor = nextClips[index] ?? nextClips[index - 1] ?? null;
      setClips(() => {
        onChange?.(nextClips);
        return nextClips;
      });
      selectedIdRef.current = neighbor?.id ?? null;
      setSelectedId(neighbor?.id ?? null);
      setClipThumbs((thumbs) => {
        const prev = thumbs[id];
        if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
        const nextThumbs = { ...thumbs };
        delete nextThumbs[id];
        return nextThumbs;
      });
      if (!neighbor) return;
      const nextTime = clipStartMs(nextClips, Math.min(index, nextClips.length - 1));
      if (locateClip(nextClips, playheadRef.current)?.clip.id !== neighbor.id) {
        seek(nextTime);
      }
    }, [onChange, recordHistory, seek]);

    const exportVideo = useCallback(async () => {
      const picture = videoTrackClips(clips);
      if (!picture.length) return null;
      setBusy(true);
      setProgress(0);
      setError(null);
      try {
        const first = sourceMap[picture[0]?.sourceId ?? ""];
        const result = await exportTimeline({
          clips: clips.map((clip) => ({
            file: sourceMap[clip.sourceId]?.file ?? new Blob(),
            inMs: clip.inMs,
            outMs: clip.outMs,
            volume: clip.volume,
            muted: Boolean(clip.muted) || hasDetachedAudio(clips, clip.id),
            fadeInMs: clip.fadeInMs,
            fadeOutMs: clip.fadeOutMs,
            kind: clip.kind,
            startMs: clip.startMs,
          })),
          width: first?.width || 1280,
          height: first?.height || 720,
          onProgress: setProgress,
        });
        setLastExport(result);
        onExport?.(result);
        return result;
      } catch (err) {
        report(err);
        return null;
      } finally {
        setBusy(false);
        setProgress(null);
      }
    }, [clips, onExport, report, sourceMap]);

    const download = useCallback(
      (filename?: string) => {
        if (!lastExport) return;
        downloadBlob(lastExport.blob, filename ?? lastExport.filename);
      },
      [lastExport],
    );

    const addDroppedFiles = useCallback(
      (fileList: FileList | File[]) => {
        const files = [...fileList].filter(
          (file) =>
            file.type.startsWith("video/") ||
            file.type.startsWith("audio/") ||
            VIDEO_FILE.test(file.name) ||
            AUDIO_FILE.test(file.name),
        );
        files.forEach((file) => void addSource(file, file.name).catch(() => undefined));
      },
      [addSource],
    );

    const onDragEnter = useCallback((event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setFileHover(true);
    }, []);

    const onDragOver = useCallback((event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }, []);

    const onDragLeave = useCallback((event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setFileHover(false);
    }, []);

    const onDrop = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault();
        dragDepth.current = 0;
        setFileHover(false);
        addDroppedFiles(event.dataTransfer.files);
      },
      [addDroppedFiles],
    );

    useImperativeHandle(
      ref,
      () => ({
        addSource,
        split,
        deleteSelected,
        undo,
        redo,
        exportVideo,
        download,
        normalizeSelected,
        unlinkSelected,
      }),
      [addSource, deleteSelected, download, exportVideo, normalizeSelected, redo, split, undo, unlinkSelected],
    );

    useEffect(() => {
      const onPointerDown = (event: PointerEvent) => {
        editorActiveRef.current = !!rootRef.current?.contains(event.target as Node);
      };
      window.addEventListener("pointerdown", onPointerDown, true);
      return () => window.removeEventListener("pointerdown", onPointerDown, true);
    }, []);

    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        const root = rootRef.current;
        if (!root) return;
        const target = event.target;
        if (!editorActiveRef.current && !(target instanceof Node && root.contains(target))) return;
        if (isTypingTarget(target)) return;

        const meta = event.metaKey || event.ctrlKey;
        if (meta && (event.key === "z" || event.key === "Z")) {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (meta && (event.key === "y" || event.key === "Y")) {
          event.preventDefault();
          redo();
          return;
        }
        if (meta) return;

        if (event.code === "Space") {
          if (target instanceof HTMLElement && target.closest("button, a, [role='button']")) return;
          if (!clipsRef.current.length) return;
          event.preventDefault();
          togglePlay();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          if (!clipsRef.current.length) return;
          event.preventDefault();
          const step = event.shiftKey ? SKIP_MS : FRAME_MS;
          handleScrub(playheadRef.current + (event.key === "ArrowLeft" ? -step : step));
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const clipsNow = clipsRef.current;
          if (!clipsNow.length) return;
          event.preventDefault();
          const current = selectedIdRef.current;
          let index = clipsNow.findIndex((clip) => clip.id === current);
          if (index < 0) index = locateClip(clipsNow, playheadRef.current)?.index ?? 0;
          const nextIndex =
            event.key === "ArrowDown"
              ? Math.min(clipsNow.length - 1, index + 1)
              : Math.max(0, index - 1);
          const clip = clipsNow[nextIndex];
          if (clip) setSelectedId(clip.id);
          return;
        }
        if (event.key === "Home") {
          if (!clipsRef.current.length) return;
          event.preventDefault();
          handleScrub(0);
          return;
        }
        if (event.key === "End") {
          if (!clipsRef.current.length) return;
          event.preventDefault();
          handleScrub(timelineDuration(clipsRef.current));
          return;
        }
        if (event.key === "s" || event.key === "S") {
          event.preventDefault();
          split(event.shiftKey);
          return;
        }
        if (event.key === "m" || event.key === "M") {
          event.preventDefault();
          toggleMute();
          return;
        }
        if (event.key === "u" || event.key === "U") {
          event.preventDefault();
          unlinkSelected();
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          if (!selectedIdRef.current) return;
          event.preventDefault();
          deleteSelected();
          return;
        }
        if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          timelineRef.current?.zoomBy(1 / 1.25);
          return;
        }
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          timelineRef.current?.zoomBy(1.25);
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          timelineRef.current?.zoomFit();
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [deleteSelected, handleScrub, redo, split, toggleMute, togglePlay, undo, unlinkSelected]);

    const shortcutMod =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
    const selected = clips.find((clip) => clip.id === selectedId) ?? null;
    const selectedSource = selected ? sourceMap[selected.sourceId] : undefined;
    const mixerEnabled =
      selected != null && clipHasPlayableAudio(clips, selected, selectedSource?.hasAudio !== false);
    const gainPercent = Math.round((selected?.volume ?? 1) * 100);
    const canUnlink = selected != null && mixerEnabled && isVideoClip(selected);
    const audioMoved = selected != null && isVideoClip(selected) && hasDetachedAudio(clips, selected.id);

    return (
      <div
        ref={rootRef}
        tabIndex={-1}
        className={["rmt-editor", fileHover ? "is-file-hover" : "", className].filter(Boolean).join(" ")}
        style={style}
        role="region"
        aria-label="Video editor"
        aria-busy={busy}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="rmt-editor__toolbar" role="toolbar" aria-label="Editor tools">
          <div className="rmt-editor__tools">
            <IconButton label="Split" shortcut="S" disabled={!clips.length} onClick={() => split()}>
              <IconSplit />
            </IconButton>
            <IconButton
              label="Split all tracks"
              shortcut="Shift+S"
              disabled={!clips.length}
              onClick={() => split(true)}
            >
              <IconSplitTracks />
            </IconButton>
            <IconButton label="Delete" shortcut="Delete" disabled={!selected} onClick={deleteSelected}>
              <IconTrash />
            </IconButton>
            <span className="rmt-editor__tools-gap" aria-hidden="true" />
            <IconButton label="Undo" shortcut={`${shortcutMod}Z`} disabled={!canUndo} onClick={undo}>
              <IconUndo />
            </IconButton>
            <IconButton label="Redo" shortcut={`${shortcutMod}+Shift+Z`} disabled={!canRedo} onClick={redo}>
              <IconRedo />
            </IconButton>
            {showOpenFile && (
              <IconButton label="Open file" disabled={busy} onClick={() => fileRef.current?.click()}>
                <IconOpen />
              </IconButton>
            )}
          </div>
          {showOpenFile && (
            <input
              ref={fileRef}
              type="file"
              accept="video/*,audio/*,.webm,.m4a,.mp3,.ogg,.wav,.aac,.flac"
              hidden
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                files.forEach((file) => void addSource(file, file.name));
                event.target.value = "";
              }}
            />
          )}
          <div className="rmt-editor__export">
            <button
              type="button"
              className="rmt-btn rmt-btn--primary"
              onClick={() => void exportVideo()}
              disabled={!pictureClips.length || busy}
              aria-label={
                progress == null
                  ? exportLabel
                  : `${exportLabel} ${Math.round(progress * 100)} percent`
              }
            >
              {progress == null ? exportLabel : `${exportLabel} ${Math.round(progress * 100)}%`}
            </button>
            {progress != null && (
              <span className="rmt-sr-only" role="status">
                {exportLabel} {Math.round(progress * 100)}%
              </span>
            )}
            {showDownload && (
              <IconButton
                label={downloadLabel}
                disabled={!lastExport || !clips.length}
                onClick={() => download()}
              >
                <IconDownload />
              </IconButton>
            )}
          </div>
        </div>

        <div className="rmt-editor__mixer">
          <IconButton
            label={selected?.muted || audioMoved ? "Unmute" : "Mute"}
            shortcut="M"
            disabled={!mixerEnabled}
            pressed={Boolean(selected?.muted) || audioMoved}
            onClick={toggleMute}
          >
            {selected?.muted || audioMoved ? <IconMute /> : <IconSpeaker />}
          </IconButton>
          <IconButton
            label="Unlink audio"
            shortcut="U"
            disabled={!canUnlink}
            onClick={unlinkSelected}
          >
            <IconUnlink />
          </IconButton>
          <label className="rmt-editor__gain">
            Gain
            <input
              type="range"
              min={0}
              max={200}
              step={1}
              value={mixerEnabled ? gainPercent : 100}
              disabled={!mixerEnabled}
              aria-label="Gain"
              aria-valuetext={mixerEnabled ? `${gainPercent} percent` : "No audio"}
              onChange={(event) => handleGainInput(Number(event.target.value))}
              onPointerUp={handleGainCommit}
              onBlur={handleGainCommit}
            />
            <span className="rmt-editor__gain-value">
              {!selected ? "—" : !mixerEnabled ? "No audio" : selected.muted ? "Muted" : `${gainPercent}%`}
            </span>
          </label>
          <button
            type="button"
            className="rmt-btn"
            disabled={!mixerEnabled || busy}
            onClick={() => void normalizeSelected()}
          >
            Normalize
          </button>
        </div>

        <div
          className={[
            "rmt-editor__preview",
            clips.length ? (playing ? "is-playing" : "is-paused") : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => {
            if (clips.length) togglePlay();
          }}
        >
          <video
            ref={videoRef}
            className="rmt-editor__video"
            playsInline
            preload="auto"
            aria-hidden="true"
          />
          {extraAudio.map((clip) => (
            <audio
              key={clip.id}
              className="rmt-editor__audio"
              ref={(node) => {
                if (node) extraAudioEls.current.set(clip.id, node);
                else extraAudioEls.current.delete(clip.id);
              }}
              preload="auto"
              playsInline
            />
          ))}
          {!clips.length && (
            <div className="rmt-editor__empty">
              <strong>No clips yet</strong>
              <span>
                {showOpenFile
                  ? "Drop a video or audio file, send a recording, or open a file."
                  : "Drop a video or audio file, or send a recording."}
              </span>
            </div>
          )}
          {clips.length > 0 && (
            <button
              type="button"
              className="rmt-editor__play"
              aria-label={playing ? "Pause" : "Play"}
              aria-keyshortcuts="Space"
              title={playing ? "Pause (Space)" : "Play (Space)"}
              onClick={(event) => {
                event.stopPropagation();
                togglePlay();
              }}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
          )}
          {clips.length > 0 && (
            <div className="rmt-editor__time" aria-hidden="true">
              {formatPrecise(playheadMs)} / {formatPrecise(totalMs)}
            </div>
          )}
        </div>

        <Timeline
          ref={timelineRef}
          clips={clips}
          sources={sourceMap}
          thumbs={clipThumbs}
          selectedId={selectedId}
          playheadMs={playheadMs}
          onSelect={setSelectedId}
          onSeek={handleSeek}
          onScrub={handleScrub}
          onTrim={handleTrim}
          onTrimEnd={handleTrimEnd}
          onFade={handleFade}
          onFadeEnd={handleFadeEnd}
          onReorder={handleReorder}
          onMoveAudio={handleMoveAudio}
          onMoveAudioEnd={handleMoveAudioEnd}
          showFades
          showAudioTrack
          emptyHint={
            showOpenFile
              ? "Drop a video or audio file, send a recording, or open a file."
              : "Drop a video or audio file, or send a recording."
          }
        />

        {error && (
          <p className="rmt-editor__error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  },
);

const blobIds = new WeakMap<Blob, string>();

function sourceIdFor(file: Blob): string {
  const existing = blobIds.get(file);
  if (existing) return existing;
  const id = uid("src");
  blobIds.set(file, id);
  return id;
}

function splitVideoClip(clip: EditorClip, offsetMs: number): [EditorClip, EditorClip] | null {
  const sourceLocal = clip.inMs + offsetMs;
  if (sourceLocal <= clip.inMs + MIN_CLIP_MS || sourceLocal >= clip.outMs - MIN_CLIP_MS) return null;
  return [
    { ...clip, id: uid("clip"), outMs: sourceLocal },
    { ...clip, id: uid("clip"), inMs: sourceLocal },
  ];
}

function splitAudioClip(clip: EditorClip, playheadMs: number): [EditorClip, EditorClip] | null {
  const start = audioClipStart(clip);
  const local = playheadMs - start;
  if (local <= MIN_CLIP_MS || local >= clipDuration(clip) - MIN_CLIP_MS) return null;
  const sourceLocal = clip.inMs + local;
  return [
    { ...clip, id: uid("clip"), outMs: sourceLocal },
    { ...clip, id: uid("clip"), inMs: sourceLocal, startMs: playheadMs },
  ];
}

function positiveMs(value: number | undefined): number | undefined {
  return value && value > 0 ? value : undefined;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

function isFileDrag(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv)$/i;
const AUDIO_FILE = /\.(mp3|m4a|wav|ogg|oga|aac|flac|weba|webm)$/i;

function wait(video: HTMLVideoElement, event: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.removeEventListener(event, done);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, done);
      resolve();
    };
    video.addEventListener(event, done);
  });
}

function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds)) return Promise.resolve();
  if (Math.abs(video.currentTime - seconds) < 0.04) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 350);
    video.addEventListener("seeked", finish);
    video.currentTime = seconds;
  });
}
