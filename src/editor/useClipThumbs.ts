import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { EditorClip } from "../types";
import { extractThumbnail } from "./probe";

export function useClipThumbs(sourcesRef: MutableRefObject<Record<string, { file: Blob }>>) {
  const [clipThumbs, setClipThumbs] = useState<Record<string, string>>({});
  const thumbsRef = useRef(clipThumbs);
  thumbsRef.current = clipThumbs;

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
    [rememberThumb, sourcesRef],
  );

  const applySnapshot = useCallback(
    (clipsNext: EditorClip[]) => {
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
    },
    [captureThumb],
  );

  const transferThumb = useCallback((fromId: string | undefined, toId: string | undefined) => {
    if (!fromId) return;
    setClipThumbs((current) => {
      const inherited = current[fromId];
      const next = { ...current };
      delete next[fromId];
      if (inherited && toId) next[toId] = inherited;
      return next;
    });
  }, []);

  const copyThumb = useCallback((fromId: string, toId: string) => {
    const inherited = thumbsRef.current[fromId];
    if (!inherited) return;
    setClipThumbs((current) => ({ ...current, [toId]: inherited }));
  }, []);

  const forgetThumb = useCallback((id: string) => {
    setClipThumbs((thumbs) => {
      const prev = thumbs[id];
      if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
      const next = { ...thumbs };
      delete next[id];
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      Object.values(thumbsRef.current).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []);

  return { clipThumbs, thumbsRef, captureThumb, applySnapshot, transferThumb, copyThumb, forgetThumb };
}
