import { useLayoutEffect, useRef, useState } from "react";
import {
  VideoEditor,
  VideoRecorder,
  type RecordingResult,
  type VideoEditorHandle,
} from "@anthonyrivas/react-media-tools";

type Theme = "dark" | "light";

export default function App() {
  const editorRef = useRef<VideoEditorHandle>(null);
  const takeCount = useRef(0);
  const [theme, setTheme] = useState<Theme>("dark");
  const [message, setMessage] = useState("Record a take, or drop a file on the editor.");

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  const ingest = async (result: RecordingResult) => {
    takeCount.current += 1;
    const name = `Take ${takeCount.current}`;
    try {
      await editorRef.current?.addSource({
        file: result.blob,
        name,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
      });
      setMessage(`${name} added to the editor. Trim, split, or export when you are ready.`);
    } catch (error) {
      takeCount.current = Math.max(0, takeCount.current - 1);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="studio">
      <header className="studio__header">
        <div className="studio__top">
          <div>
            <p className="studio__eyebrow">Media tools</p>
            <h1>Recorder & editor</h1>
          </div>
          <div className="studio__themes" role="group" aria-label="Color theme">
            <button
              type="button"
              className="studio__theme"
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              Dark
            </button>
            <button
              type="button"
              className="studio__theme"
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              Light
            </button>
          </div>
        </div>
        <p>
          Two React components, no server. Record camera, screen, or both; edit the
          result in the browser; download a video file.
        </p>
      </header>

      <section className="studio__panel">
        <div className="studio__panel-head">
          <h2>Recorder</h2>
          <p>Chrome, Firefox, and Safari. Unavailable capture modes stay off.</p>
        </div>
        <VideoRecorder
          onRecordingStop={(result) => void ingest(result)}
          onError={(error) => setMessage(error.message)}
        />
      </section>

      <section className="studio__panel">
        <div className="studio__panel-head">
          <h2>Editor</h2>
          <p>{message}</p>
        </div>
        <VideoEditor
          ref={editorRef}
          showOpenFile
          onExport={(result) => setMessage(`Exported ${result.filename}`)}
          onError={(error) => setMessage(error.message)}
        />
      </section>
    </main>
  );
}
