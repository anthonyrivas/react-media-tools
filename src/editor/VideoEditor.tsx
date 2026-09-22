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
import { extractThumbnail, probeMedia } from "./probe";
import { Timeline, type TimelineHandle, type TimelineSource } from "./Timeline";
import { IconButton } from "../IconButton";
import { IconDownload, IconOpen, IconPause, IconPlay, IconRedo, IconSplit, IconTrash, IconUndo } from "../icons";
import { extractPeaks } from "./waveform";
import {
  FRAME_MS,
  MIN_CLIP_MS,
  SKIP_MS,
  clamp,
  clipDuration,
  clipStartMs,
  locateClip,
  totalDuration,
} from "./timelineMath";

export type VideoEditorHandle = {
  addSource: (input: EditorInput | Blob, name?: string) => Promise<void>;
  split: () => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  exportVideo: () => Promise<ExportResult | null>;
  download: (filename?: string) => void;
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
    const applyingHistoryRef = useRef(false);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);

    clipsRef.current = clips;
    sourcesRef.current = sourceMap;
    playingRef.current = playing;
    thumbsRef.current = clipThumbs;
    selectedIdRef.current = selectedId;

    const totalMs = useMemo(() => totalDuration(clips), [clips]);

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
        const clip: EditorClip = {
          id: uid("clip"),
          sourceId,
          inMs: 0,
          outMs: durationMs,
        };
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

    const addSource = useCallback(
      async (input: EditorInput | Blob, name?: string) => {
        const item: EditorInput = input instanceof Blob ? { file: input, name } : input;
        const id = item.id ?? sourceIdFor(item.file);
        const existing = sourcesRef.current[id];
        if (existing) {
          appendClip(existing.id, existing.durationMs, existing.file);
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
          if (durationMs <= 0) {
            throw new Error("Could not read this video. Try another file, or record again.");
          }
          const url = URL.createObjectURL(item.file);
          const loaded: LoadedSource = {
            id,
            file: item.file,
            url,
            name: item.name ?? name ?? `Clip ${Object.keys(sourcesRef.current).length + 1}`,
            durationMs,
            width: item.width || probed.width || 1280,
            height: item.height || probed.height || 720,
          };
          setSourceMap((current) => ({ ...current, [id]: loaded }));
          appendClip(id, durationMs, item.file);
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
        Object.values(thumbsRef.current).forEach((url) => {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        });
      };
    }, []);

    useEffect(() => {
      if (playing) return;
      videoRef.current?.pause();
    }, [playing]);

    const showClip = useCallback(
      async (index: number, offsetMs: number, autoplay: boolean) => {
        const video = videoRef.current;
        const clipsNow = clipsRef.current;
        const clip = clipsNow[index];
        if (!video || !clip) return;
        const source = sourcesRef.current[clip.sourceId];
        if (!source) return;

        const gen = (syncGenRef.current += 1);
        seekingRef.current = true;
        clipIndexRef.current = index;
        const target = (clip.inMs + clamp(offsetMs, 0, clipDuration(clip))) / 1000;

        try {
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
      [],
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
        if (hit) clipIndexRef.current = hit.index;
        void syncToPlayhead(next, playingRef.current);
        return next;
      },
      [setPlayhead, syncToPlayhead],
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
      const total = totalDuration(clips);
      if (playheadRef.current > total) setPlayhead(total);
      const hit = locateClip(clips, playheadRef.current);
      if (hit) clipIndexRef.current = hit.index;
      if (skipClipSyncRef.current) return;
      if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
    }, [clips, setPlayhead, syncToPlayhead]);

    useEffect(() => {
      if (!playing) return;
      const video = videoRef.current;
      if (!video) return;
      let raf = 0;
      let active = true;

      const keepPlaying = () => {
        if (active && playingRef.current && video.paused && !seekingRef.current) {
          void video.play().catch(() => undefined);
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
          video.pause();
          return;
        }

        clipIndexRef.current = index + 1;
        setPlayhead(clipStartMs(clipsNow, index + 1));

        const timeMs = video.currentTime * 1000;
        const sameSource =
          prev.sourceId === nextClip.sourceId && loadedSourceIdRef.current === nextClip.sourceId;
        const stillInNext = timeMs < nextClip.outMs;
        const nearNextIn = nextClip.inMs - timeMs < 500;

        // Split or other continuous cut on the same file: do not pause or seek.
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

          const sourceTime = video.currentTime * 1000;
          if (sourceTime >= clip.outMs || video.ended) {
            goToNextClip();
          } else if (sourceTime >= clip.inMs) {
            setPlayhead(clipStartMs(clipsNow, index) + (sourceTime - clip.inMs));
            keepPlaying();
          }
        }
        raf = requestAnimationFrame(tick);
      };

      const onEnded = () => {
        if (active) goToNextClip();
      };

      video.addEventListener("ended", onEnded);

      const hit = locateClip(clipsRef.current, playheadRef.current);
      void (hit ? showClip(hit.index, hit.offsetMs, true) : Promise.resolve()).then(() => {
        if (active) raf = requestAnimationFrame(tick);
      });

      return () => {
        active = false;
        cancelAnimationFrame(raf);
        video.removeEventListener("ended", onEnded);
      };
    }, [playing, setPlayhead, showClip]);

    const togglePlay = useCallback(() => {
      if (!clipsRef.current.length) return;
      if (playheadRef.current >= totalDuration(clipsRef.current) - 250) {
        setPlayhead(0);
        clipIndexRef.current = 0;
      }
      setPlaying((value) => !value);
    }, [setPlayhead]);

    const handleTrim = useCallback(
      (id: string, inMs: number, outMs: number, edge: "in" | "out") => {
        if (!trimBeforeRef.current) trimBeforeRef.current = captureState();
        skipClipSyncRef.current = true;
        const next = clipsRef.current.map((clip) => (clip.id === id ? { ...clip, inMs, outMs } : clip));
        clipsRef.current = next;
        setClips(next);
        onChange?.(next);
        const index = next.findIndex((clip) => clip.id === id);
        if (index < 0) return;
        const start = clipStartMs(next, index);
        const duration = Math.max(0, outMs - inMs);
        const playhead = edge === "in" ? start : start + duration;
        setPlayhead(playhead);
        clipIndexRef.current = index;
        void showClip(index, edge === "in" ? 0 : Math.max(0, duration - 40), false);
      },
      [captureState, onChange, setPlayhead, showClip],
    );

    const handleTrimEnd = useCallback(() => {
      const before = trimBeforeRef.current;
      trimBeforeRef.current = null;
      if (before && !sameClips(before.clips, clipsRef.current)) {
        historyRef.current.push(before);
        syncHistoryButtons();
      }
      skipClipSyncRef.current = false;
      const hit = locateClip(clipsRef.current, playheadRef.current);
      if (hit) void captureThumb(hit.clip);
      if (!playingRef.current) void syncToPlayhead(playheadRef.current, false);
    }, [captureThumb, syncHistoryButtons, syncToPlayhead]);

    const handleScrub = useCallback(
      (ms: number) => {
        playingRef.current = false;
        setPlaying(false);
        const next = setPlayhead(ms);
        const hit = locateClip(clipsRef.current, next);
        if (hit) {
          clipIndexRef.current = hit.index;
          setSelectedId(hit.clip.id);
        }
        pendingScrub.current = next;
        if (scrubRaf.current) return;
        scrubRaf.current = requestAnimationFrame(() => {
          scrubRaf.current = 0;
          const time = pendingScrub.current;
          if (time != null) void syncToPlayhead(time, false);
        });
      },
      [setPlayhead, syncToPlayhead],
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
      const left: EditorClip = { ...hit.clip, id: uid("clip"), outMs: local };
      const right: EditorClip = { ...hit.clip, id: uid("clip"), inMs: local };
      setClips((current) => {
        const next = [...current.slice(0, hit.index), left, right, ...current.slice(hit.index + 1)];
        onChange?.(next);
        return next;
      });
      setSelectedId(right.id);
      clipIndexRef.current = hit.index + 1;
      setClipThumbs((current) => {
        const inherited = current[hit.clip.id];
        const next = { ...current };
        delete next[hit.clip.id];
        if (inherited) next[left.id] = inherited;
        return next;
      });
      void captureThumb(right);
    }, [captureThumb, onChange, recordHistory]);

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
      if (!clips.length) return null;
      setBusy(true);
      setProgress(0);
      setError(null);
      try {
        const first = sourceMap[clips[0]?.sourceId ?? ""];
        const result = await exportTimeline({
          clips: clips.map((clip) => ({
            file: sourceMap[clip.sourceId]?.file ?? new Blob(),
            inMs: clip.inMs,
            outMs: clip.outMs,
            volume: clip.volume,
            muted: clip.muted,
            fadeInMs: clip.fadeInMs,
            fadeOutMs: clip.fadeOutMs,
          })),
          width: first?.width ?? 1280,
          height: first?.height ?? 720,
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
          (file) => file.type.startsWith("video/") || VIDEO_FILE.test(file.name),
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
      () => ({ addSource, split, deleteSelected, undo, redo, exportVideo, download }),
      [addSource, deleteSelected, download, exportVideo, redo, split, undo],
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
          handleScrub(totalDuration(clipsRef.current));
          return;
        }
        if (event.key === "s" || event.key === "S") {
          event.preventDefault();
          split();
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
    }, [deleteSelected, handleScrub, redo, split, togglePlay, undo]);

    const shortcutMod =
      typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
    const selected = clips.find((clip) => clip.id === selectedId) ?? null;

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
            <IconButton label="Split" shortcut="S" disabled={!clips.length} onClick={split}>
              <IconSplit />
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
              accept="video/*"
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
              disabled={!clips.length || busy}
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
          {!clips.length && (
            <div className="rmt-editor__empty">
              <strong>No clips yet</strong>
              <span>
                {showOpenFile
                  ? "Drop a video here, send a recording, or open a file."
                  : "Drop a video here, or send a recording."}
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
          onReorder={handleReorder}
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
