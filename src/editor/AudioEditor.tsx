import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EditorClip, EditorInput, ExportResult } from "../types";
import { downloadBlob, formatPrecise, uid } from "../utils";
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
  IconTrash,
  IconUndo,
  IconDuplicate,
} from "../icons";
import {
  MAX_GAIN,
  clipGain,
  envelopeAt,
  normalizedVolume,
  withClampedAudio,
} from "./audioGain";
import { exportAudioTimeline, measureClipPeak } from "./exportAudio";
import { cloneSnapshot, createHistory, sameClips, type EditorSnapshot } from "./history";
import { probeMedia } from "./probe";
import { Timeline, type TimelineHandle, type TimelineSource } from "./Timeline";
import { extractPeaks, paintWaveform, type WaveformPeaks } from "./waveform";
import {
  FRAME_MS,
  MIN_CLIP_MS,
  SKIP_MS,
  clamp,
  clipDuration,
  clipStartMs,
  duplicateClip,
  locateClip,
  totalDuration,
} from "./timelineMath";

export type AudioEditorHandle = {
  addSource: (input: EditorInput | Blob, name?: string) => Promise<void>;
  split: () => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  normalizeSelected: () => Promise<void>;
  exportAudio: () => Promise<ExportResult | null>;
  download: (filename?: string) => void;
};

export type AudioEditorProps = {
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
};

export const AudioEditor = forwardRef<AudioEditorHandle, AudioEditorProps>(function AudioEditor(
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
  const audioRef = useRef<HTMLAudioElement>(null);
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
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const skipClipSyncRef = useRef(false);
  const scrubRaf = useRef(0);
  const pendingScrub = useRef<number | null>(null);
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

  clipsRef.current = clips;
  sourcesRef.current = sourceMap;
  playingRef.current = playing;
  selectedIdRef.current = selectedId;

  const totalMs = useMemo(() => totalDuration(clips), [clips]);
  const selected = clips.find((clip) => clip.id === selectedId) ?? null;
  const playheadClip = locateClip(clips, playheadMs)?.clip ?? selected;

  const report = useCallback(
    (err: unknown) => {
      const next = err instanceof Error ? err : new Error(String(err));
      setError(next.message);
      onError?.(next);
    },
    [onError],
  );

  const setPlayhead = useCallback((ms: number) => {
    const next = clamp(ms, 0, Math.max(0, totalDuration(clipsRef.current)));
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
      applyingHistoryRef.current = false;
    },
    [onChange, setPlayhead],
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
    (sourceId: string, durationMs: number) => {
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
    },
    [onChange, recordHistory, setPlayhead],
  );

  const addSource = useCallback(
    async (input: EditorInput | Blob, name?: string) => {
      const item: EditorInput = input instanceof Blob ? { file: input, name } : input;
      const id = item.id ?? sourceIdFor(item.file);
      const existing = sourcesRef.current[id];
      if (existing) {
        appendClip(existing.id, existing.durationMs);
        return;
      }
      if (knownIds.current.has(id)) return;
      knownIds.current.add(id);
      setBusy(true);
      setError(null);
      try {
        const probed = await probeMedia(item.file, { durationMs: item.durationMs });
        const durationMs = positiveMs(item.durationMs) ?? positiveMs(probed.durationMs) ?? 0;
        if (durationMs <= 0) {
          throw new Error("Could not read this audio. Try another file, or record again.");
        }
        const url = URL.createObjectURL(item.file);
        const loaded: LoadedSource = {
          id,
          file: item.file,
          url,
          name: item.name ?? name ?? `Clip ${Object.keys(sourcesRef.current).length + 1}`,
          durationMs,
        };
        setSourceMap((current) => ({ ...current, [id]: loaded }));
        appendClip(id, durationMs);
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
    [appendClip, report],
  );

  useEffect(() => {
    incoming?.forEach((item) => {
      void addSource(item).catch(() => undefined);
    });
  }, [addSource, incoming]);

  useEffect(() => {
    return () => {
      if (scrubRaf.current) cancelAnimationFrame(scrubRaf.current);
      void audioCtxRef.current?.close().catch(() => undefined);
    };
  }, []);

  const connectGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || mediaSourceRef.current) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    try {
      const ctx = new AudioCtx();
      const gain = ctx.createGain();
      const source = ctx.createMediaElementSource(audio);
      source.connect(gain);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
      mediaSourceRef.current = source;
    } catch {
      mediaSourceRef.current = null;
    }
  }, []);

  const applyLiveGain = useCallback((clip: EditorClip | null, localMs: number) => {
    const value = clip ? envelopeAt(clip, localMs) : 1;
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = value;
      return;
    }
    const audio = audioRef.current;
    if (audio) audio.volume = Math.min(1, Math.max(0, value));
  }, []);

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
        connectGraph();
        if (autoplay) void audioCtxRef.current?.resume();
        if (loadedSourceIdRef.current !== source.id) {
          audio.src = source.url;
          loadedSourceIdRef.current = source.id;
          await wait(audio, "loadeddata", 5000);
        }
        if (gen !== syncGenRef.current) return;
        if (Math.abs(audio.currentTime - target) > 0.08) {
          await seekTo(audio, target);
        }
        if (gen !== syncGenRef.current) return;
        if (autoplay) {
          if (audio.paused) await audio.play();
        } else {
          audio.pause();
        }
      } catch {
        if (gen === syncGenRef.current && !autoplay) audio.pause();
      } finally {
        if (gen === syncGenRef.current) seekingRef.current = false;
      }
    },
    [applyLiveGain, connectGraph],
  );

  const syncToPlayhead = useCallback(
    async (ms: number, autoplay: boolean) => {
      const hit = locateClip(clipsRef.current, ms);
      if (!hit) return;
      await showClip(hit.index, hit.offsetMs, autoplay);
    },
    [showClip],
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
    [applyLiveGain, setPlayhead, syncToPlayhead],
  );

  useEffect(() => {
    if (playing) return;
    audioRef.current?.pause();
  }, [playing]);

  useEffect(() => {
    if (!clips.length) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
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
  }, [applyLiveGain, clips, setPlayhead, syncToPlayhead]);

  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    if (!audio) return;
    let raf = 0;
    let active = true;

    const keepPlaying = () => {
      if (active && playingRef.current && audio.paused && !seekingRef.current) {
        void audio.play().catch(() => undefined);
      }
    };

    const goToNextClip = () => {
      const clipsNow = clipsRef.current;
      const index = clipIndexRef.current;
      const prev = clipsNow[index];
      const nextClip = clipsNow[index + 1];
      if (!prev || !nextClip) {
        playingRef.current = false;
        setPlaying(false);
        setPlayhead(totalDuration(clipsNow));
        audio.pause();
        return;
      }

      clipIndexRef.current = index + 1;
      setPlayhead(clipStartMs(clipsNow, index + 1));
      applyLiveGain(nextClip, 0);

      const timeMs = audio.currentTime * 1000;
      const sameSource =
        prev.sourceId === nextClip.sourceId && loadedSourceIdRef.current === nextClip.sourceId;
      const stillInNext = timeMs < nextClip.outMs;
      const nearNextIn = nextClip.inMs - timeMs < 500;

      if (sameSource && stillInNext && nearNextIn) {
        keepPlaying();
        return;
      }

      void showClip(index + 1, 0, true);
    };

    const tick = () => {
      if (!active) return;
      if (!seekingRef.current) {
        const clipsNow = clipsRef.current;
        const index = clipIndexRef.current;
        const clip = clipsNow[index];
        if (!clip) {
          setPlaying(false);
          return;
        }

        const sourceTime = audio.currentTime * 1000;
        if (sourceTime >= clip.outMs || audio.ended) {
          goToNextClip();
        } else if (sourceTime >= clip.inMs) {
          const local = sourceTime - clip.inMs;
          setPlayhead(clipStartMs(clipsNow, index) + local);
          applyLiveGain(clip, local);
          keepPlaying();
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const onEnded = () => {
      if (active) goToNextClip();
    };

    audio.addEventListener("ended", onEnded);
    void audioCtxRef.current?.resume();

    const hit = locateClip(clipsRef.current, playheadRef.current);
    void (hit ? showClip(hit.index, hit.offsetMs, true) : Promise.resolve()).then(() => {
      if (active) raf = requestAnimationFrame(tick);
    });

    return () => {
      active = false;
      cancelAnimationFrame(raf);
      audio.removeEventListener("ended", onEnded);
    };
  }, [applyLiveGain, playing, setPlayhead, showClip]);

  const togglePlay = useCallback(() => {
    if (!clipsRef.current.length) return;
    if (playheadRef.current >= totalDuration(clipsRef.current) - 250) {
      setPlayhead(0);
      clipIndexRef.current = 0;
    }
    connectGraph();
    void audioCtxRef.current?.resume();
    setPlaying((value) => !value);
  }, [connectGraph, setPlayhead]);

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
    },
    [applyLiveGain, onChange],
  );

  const handleTrim = useCallback(
    (id: string, inMs: number, outMs: number, edge: "in" | "out") => {
      if (!trimBeforeRef.current) trimBeforeRef.current = captureState();
      skipClipSyncRef.current = true;
      patchClip(id, { inMs, outMs });
      const next = clipsRef.current;
      const index = next.findIndex((clip) => clip.id === id);
      if (index < 0) return;
      const start = clipStartMs(next, index);
      const duration = Math.max(0, outMs - inMs);
      const playhead = edge === "in" ? start : start + duration;
      setPlayhead(playhead);
      clipIndexRef.current = index;
      void showClip(index, edge === "in" ? 0 : Math.max(0, duration - 40), false);
    },
    [captureState, patchClip, setPlayhead, showClip],
  );

  const handleTrimEnd = useCallback(() => {
    commitCoalesced(trimBeforeRef);
    skipClipSyncRef.current = false;
    if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
  }, [commitCoalesced, syncToPlayhead]);

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
      if (!id) return;
      if (!gainBeforeRef.current) gainBeforeRef.current = captureState();
      patchClip(id, { volume: clamp(percent / 100, 0, MAX_GAIN), muted: false });
    },
    [captureState, patchClip],
  );

  const handleGainCommit = useCallback(() => {
    commitCoalesced(gainBeforeRef);
  }, [commitCoalesced]);

  const toggleMute = useCallback(() => {
    const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!clip) return;
    recordHistory();
    patchClip(clip.id, { muted: !clip.muted });
  }, [patchClip, recordHistory]);

  const normalizeSelected = useCallback(async () => {
    const clip = clipsRef.current.find((item) => item.id === selectedIdRef.current);
    const file = clip ? sourcesRef.current[clip.sourceId]?.file : undefined;
    if (!clip || !file) return;
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

  const handleReorder = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      recordHistory();
      setClips((current) => {
        const next = current.slice();
        const [moved] = next.splice(from, 1);
        if (!moved) return current;
        next.splice(to, 0, moved);
        onChange?.(next);
        return next;
      });
    },
    [onChange, recordHistory],
  );

  const handleSeek = useCallback(
    (ms: number) => {
      playingRef.current = false;
      setPlaying(false);
      const next = seek(ms);
      const hit = locateClip(clipsRef.current, next);
      if (hit) setSelectedId(hit.clip.id);
    },
    [seek],
  );

  const split = useCallback(() => {
    const hit = locateClip(clipsRef.current, playheadRef.current);
    if (!hit) return;
    const local = hit.clip.inMs + hit.offsetMs;
    if (local <= hit.clip.inMs + MIN_CLIP_MS || local >= hit.clip.outMs - MIN_CLIP_MS) return;
    recordHistory();
    const left = withClampedAudio({ ...hit.clip, id: uid("clip"), outMs: local, fadeOutMs: 0 });
    const right = withClampedAudio({ ...hit.clip, id: uid("clip"), inMs: local, fadeInMs: 0 });
    setClips((current) => {
      const next = [...current.slice(0, hit.index), left, right, ...current.slice(hit.index + 1)];
      onChange?.(next);
      return next;
    });
    setSelectedId(right.id);
    clipIndexRef.current = hit.index + 1;
  }, [onChange, recordHistory]);

  const duplicateSelected = useCallback(() => {
    const clipsNow = clipsRef.current;
    const index = clipsNow.findIndex((clip) => clip.id === selectedIdRef.current);
    const clip = clipsNow[index];
    if (!clip) return;
    recordHistory();
    const copy = withClampedAudio(duplicateClip(clip, uid("clip")));
    const next = [...clipsNow.slice(0, index + 1), copy, ...clipsNow.slice(index + 1)];
    clipsRef.current = next;
    setClips(next);
    onChange?.(next);
    selectedIdRef.current = copy.id;
    setSelectedId(copy.id);
    clipIndexRef.current = index + 1;
  }, [onChange, recordHistory]);

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
    if (!neighbor) return;
    const nextTime = clipStartMs(nextClips, Math.min(index, nextClips.length - 1));
    if (locateClip(nextClips, playheadRef.current)?.clip.id !== neighbor.id) {
      seek(nextTime);
    }
  }, [onChange, recordHistory, seek]);

  const exportAudio = useCallback(async () => {
    if (!clips.length) return null;
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const result = await exportAudioTimeline({
        clips: clips.map((clip) => ({
          ...clip,
          file: sourceMap[clip.sourceId]?.file ?? new Blob(),
        })),
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
        (file) => file.type.startsWith("audio/") || AUDIO_FILE.test(file.name),
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
      duplicateSelected,
      deleteSelected,
      undo,
      redo,
      normalizeSelected,
      exportAudio,
      download,
    }),
    [addSource, deleteSelected, download, duplicateSelected, exportAudio, normalizeSelected, redo, split, undo],
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
      if (event.key === "d" || event.key === "D") {
        event.preventDefault();
        duplicateSelected();
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
        handleScrub(totalDuration(clipsRef.current));
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        split();
        return;
      }
      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        toggleMute();
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
  }, [deleteSelected, duplicateSelected, handleScrub, redo, split, toggleMute, togglePlay, undo]);

  const shortcutMod =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const gainPercent = Math.round((selected?.volume ?? 1) * 100);
  const hit = locateClip(clips, playheadMs);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={["rmt-editor", "rmt-editor--audio", fileHover ? "is-file-hover" : "", className]
        .filter(Boolean)
        .join(" ")}
      style={style}
      role="region"
      aria-label="Audio editor"
      aria-busy={busy}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="rmt-editor__toolbar" role="toolbar" aria-label="Editor tools">
        <div className="rmt-editor__tools">
          <IconButton label="Split" shortcut="S" disabled={!clips.length} onClick={split}>
            <IconSplit />
          </IconButton>
          <IconButton label="Duplicate" shortcut="D" disabled={!selected} onClick={duplicateSelected}>
            <IconDuplicate />
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
            accept="audio/*,.webm,.m4a,.mp3,.ogg,.wav,.aac,.flac"
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
            onClick={() => void exportAudio()}
            disabled={!clips.length || busy}
            aria-label={
              progress == null ? exportLabel : `${exportLabel} ${Math.round(progress * 100)} percent`
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
          label={selected?.muted ? "Unmute" : "Mute"}
          shortcut="M"
          disabled={!selected}
          pressed={Boolean(selected?.muted)}
          onClick={toggleMute}
        >
          {selected?.muted ? <IconMute /> : <IconSpeaker />}
        </IconButton>
        <label className="rmt-editor__gain">
          Gain
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={gainPercent}
            disabled={!selected}
            aria-label="Gain"
            aria-valuetext={`${gainPercent} percent`}
            onChange={(event) => handleGainInput(Number(event.target.value))}
            onPointerUp={handleGainCommit}
            onBlur={handleGainCommit}
          />
          <span className="rmt-editor__gain-value">
            {selected ? (selected.muted ? "Muted" : `${gainPercent}%`) : "—"}
          </span>
        </label>
        <button
          type="button"
          className="rmt-btn"
          disabled={!selected || busy}
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
        <audio ref={audioRef} className="rmt-editor__audio" preload="auto" aria-hidden="true" />
        {playheadClip && sourceMap[playheadClip.sourceId]?.peaks && (
          <StageWaveform
            peaks={sourceMap[playheadClip.sourceId]!.peaks!}
            inMs={playheadClip.inMs}
            outMs={playheadClip.outMs}
            localMs={hit && hit.clip.id === playheadClip.id ? hit.offsetMs : 0}
            gain={clipGain(playheadClip)}
          />
        )}
        {!clips.length && (
          <div className="rmt-editor__empty">
            <strong>No clips yet</strong>
            <span>
              {showOpenFile
                ? "Drop audio here, send a recording, or open a file."
                : "Drop audio here, or send a recording."}
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
        selectedId={selectedId}
        playheadMs={playheadMs}
        showFades
        emptyHint={
          showOpenFile
            ? "Drop audio, send a recording, or open a file."
            : "Drop audio, or send a recording."
        }
        onSelect={setSelectedId}
        onSeek={handleSeek}
        onScrub={handleScrub}
        onTrim={handleTrim}
        onTrimEnd={handleTrimEnd}
        onFade={handleFade}
        onFadeEnd={handleFadeEnd}
        onReorder={handleReorder}
      />

      {error && (
        <p className="rmt-editor__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

function StageWaveform({
  peaks,
  inMs,
  outMs,
  localMs,
  gain,
}: {
  peaks: WaveformPeaks;
  inMs: number;
  outMs: number;
  localMs: number;
  gain: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paint = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paintWaveform(canvas, peaks, inMs, outMs);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const duration = Math.max(1, outMs - inMs);
    const x = (clamp(localMs, 0, duration) / duration) * canvas.width;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.35 + gain * 0.65);
    ctx.fillStyle = getComputedStyle(canvas).color || "#f3f1eb";
    ctx.fillRect(Math.max(0, x - 1), 0, 2, canvas.height);
    ctx.restore();
  }, [gain, inMs, localMs, outMs, peaks]);

  useLayoutEffect(() => {
    paint();
    const canvas = ref.current;
    if (!canvas) return;
    const resize = new ResizeObserver(paint);
    resize.observe(canvas);
    const theme = new MutationObserver(paint);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
      subtree: true,
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [paint]);

  return <canvas ref={ref} className="rmt-editor__wave-stage" aria-hidden="true" />;
}

const blobIds = new WeakMap<Blob, string>();

function sourceIdFor(file: Blob): string {
  const existing = blobIds.get(file);
  if (existing) return existing;
  const id = uid("src");
  blobIds.set(file, id);
  return id;
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

const AUDIO_FILE = /\.(mp3|m4a|wav|ogg|oga|aac|flac|weba|webm)$/i;

function wait(media: HTMLMediaElement, event: string, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      media.removeEventListener(event, done);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      media.removeEventListener(event, done);
      resolve();
    };
    media.addEventListener(event, done);
  });
}

function seekTo(media: HTMLMediaElement, seconds: number): Promise<void> {
  if (!Number.isFinite(seconds)) return Promise.resolve();
  if (Math.abs(media.currentTime - seconds) < 0.04) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      media.removeEventListener("seeked", finish);
      resolve();
    };
    const timer = window.setTimeout(finish, 350);
    media.addEventListener("seeked", finish);
    media.currentTime = seconds;
  });
}
