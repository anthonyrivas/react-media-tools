import { useRef, useState } from "react";

export function useEditorSources<T extends { id: string }>() {
  const [sourceMap, setSourceMap] = useState<Record<string, T>>({});
  const sourcesRef = useRef(sourceMap);
  sourcesRef.current = sourceMap;
  const knownIds = useRef(new Set<string>());
  return { sourceMap, setSourceMap, sourcesRef, knownIds };
}
