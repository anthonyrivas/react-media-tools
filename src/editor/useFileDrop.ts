import { useCallback, useRef, useState, type DragEvent } from "react";
import { isFileDrag } from "./editorDom";

export function useFileDrop(onFiles: (files: FileList) => void) {
  const [fileHover, setFileHover] = useState(false);
  const dragDepth = useRef(0);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const onDragEnter = useCallback((event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setFileHover(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    if (!isFileDrag(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setFileHover(false);
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setFileHover(false);
    onFilesRef.current(event.dataTransfer.files);
  }, []);

  return { fileHover, onDragEnter, onDragOver, onDragLeave, onDrop };
}
