# @anthonyrivas/react-media-tools

In-browser React components for recording and editing media. Nothing is uploaded unless you do it yourself — the components produce a `Blob` you can download or send to your own API.

- **`VideoRecorder`** — camera, screen, or camera-on-screen composition, with optional microphone and system audio. Pause, resume, and change sources while a take is running.
- **`AudioRecorder`** — microphone only. Pause, resume, and get an audio file (`webm` / `m4a`).
- **`VideoEditor`** — trim, split, reorder, preview, and export a new video file on the client.
- **`AudioEditor`** — the same timeline for audio files: gain, mute, fades, normalize, and export an audio `Blob`.

React 18+ is a peer dependency. Recording uses the browser capture APIs. Editing uses [Mediabunny](https://mediabunny.dev) (WebCodecs) for demux, encode, and mux. There is no backend and no `ffmpeg.wasm`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [VideoRecorder](#videorecorder)
- [AudioRecorder](#audiorecorder)
- [VideoEditor](#videoeditor)
- [AudioEditor](#audioeditor)
- [Theming](#theming)
- [Helpers and types](#helpers-and-types)
- [Browser support](#browser-support)
- [SSR](#ssr)
- [Demo](#demo)
- [Changelog](#changelog)

## Install

```bash
npm install @anthonyrivas/react-media-tools
```

Import the stylesheet once at the app root (or next to the components). Styles are CSS variables and classes (`rmt-*`); there is no CSS-in-JS and no Tailwind.

```tsx
import { VideoRecorder, AudioRecorder, VideoEditor, AudioEditor } from "@anthonyrivas/react-media-tools";
import "@anthonyrivas/react-media-tools/styles.css";
```

Camera, microphone, and screen capture require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) (`https:` or `localhost`).

## Quick start

Wire a take into the editor with `addSource`. Pass duration and size from the recorder when you have them so ingest does not have to probe twice.

```tsx
import { useRef } from "react";
import {
  VideoEditor,
  VideoRecorder,
  type RecordingResult,
  type VideoEditorHandle,
} from "@anthonyrivas/react-media-tools";
import "@anthonyrivas/react-media-tools/styles.css";

export function Studio() {
  const editorRef = useRef<VideoEditorHandle>(null);

  const ingest = async (result: RecordingResult) => {
    await editorRef.current?.addSource({
      file: result.blob,
      name: "Take 1",
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
    });
  };

  return (
    <>
      <VideoRecorder
        onRecordingStop={(result) => void ingest(result)}
        onError={(error) => console.error(error)}
      />
      <VideoEditor
        ref={editorRef}
        onExport={(result) => {
          // result.blob is the edited file
        }}
        onError={(error) => console.error(error)}
      />
    </>
  );
}
```

Built-in Download and Open file controls are **off** by default. Use the callbacks and handle methods, or pass `showDownload` / `showOpenFile` if you want those buttons in the UI.

## VideoRecorder

```tsx
<VideoRecorder
  defaultMicrophone
  onRecordingStop={(result) => {
    // result.blob, mimeType, filename, durationMs, width, height
  }}
/>
```

### Behavior

- Turn on **Camera**, **Screen**, or both. With both, the webcam is a rounded picture-in-picture on the screen share. Drag the pip to move it; drag a corner to resize. With the pip focused, arrow keys move it and Shift+arrow resizes.
- **Microphone** is on by default (`defaultMicrophone`). **System audio** is Chromium desktop only, and only when the user shares a tab/window that includes audio.
- **Start** begins the take. **Pause** / **Resume** keep the same file. You can mute, unmute, add, or remove sources while recording.
- Output size follows the webcam when that is the only video source, and the screen when screen share is active. Dimensions **lock at Start** so the file does not change size mid-take.
- **Stop** finishes the `Blob`, fires `onRecordingStop`, and releases the camera. Use `result.blob` or call `download()` on the handle.
- Unavailable modes (system audio on Safari/Firefox, screen share on iOS) stay disabled with a short explanation in the UI.

Takes with no audio track use a video-only MIME type so the file stays playable in the editor.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | | Extra class on the root (`.rmt-recorder`). |
| `style` | `CSSProperties` | | Inline style on the root. |
| `showControls` | `boolean` | `true` | Built-in source toggles and transport. Set `false` if you drive the handle yourself. |
| `showDownload` | `boolean` | `false` | Shows Download after a take. |
| `defaultMicrophone` | `boolean` | `true` | Microphone armed when the recorder mounts. |
| `onRecordingStart` | `() => void` | | Fired when recording actually begins. |
| `onRecordingStop` | `(result: RecordingResult) => void` | | Fired with the finished file. |
| `onRecordingPause` | `() => void` | | |
| `onRecordingResume` | `() => void` | | |
| `onError` | `(error: Error) => void` | | Permission failures, missing APIs, encode errors. |

### Handle

```tsx
const recorderRef = useRef<VideoRecorderHandle>(null);

await recorderRef.current?.start();
await recorderRef.current?.setSource("camera", true);
recorderRef.current?.pause();
recorderRef.current?.resume();
const result = await recorderRef.current?.stop();
recorderRef.current?.download("take.webm");
recorderRef.current?.getLastRecording();
recorderRef.current?.setOverlay({ x: 0.7, y: 0.65, width: 0.22 });
```

| Method | Description |
| --- | --- |
| `start()` | Start recording (needs at least one video source in preview). |
| `stop()` | Stop and return the `RecordingResult`, or `null` if nothing was captured. |
| `pause()` / `resume()` | Pause the encoder without finishing the file. |
| `setSource(name, enabled)` | `"camera"` \| `"screen"` \| `"microphone"` \| `"systemAudio"`. |
| `setOverlay(overlay)` | Pip position: `x`, `y`, `width` as fractions of the output (0–1). Height follows camera aspect. |
| `download(filename?)` | Save the last take. |
| `getLastRecording()` | Last `RecordingResult`, or `null`. |

`RecordingResult`: `{ blob, mimeType, filename, durationMs, width, height }`.

## AudioRecorder

```tsx
<AudioRecorder
  onRecordingStop={(result) => {
    // result.blob, mimeType, filename, durationMs
  }}
/>
```

### Behavior

- **Start** asks for the microphone and begins the take immediately. There is no camera or screen source.
- **Pause** / **Resume** keep the same file. **Stop** finishes the `Blob`, fires `onRecordingStop`, and releases the microphone.
- Output is an audio file: WebM/Opus in Chromium and Firefox, MP4/AAC (`.m4a`) in Safari when that encoder exists.
- The stage shows a live level meter while recording. Built-in Download is off by default; use `result.blob` or `download()` on the handle.

This component does not ingest into `VideoEditor`. Pass the result to `AudioEditor.addSource` (or drop the file on `AudioEditor`) when you want a timeline.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | | Extra class on the root (`.rmt-recorder.rmt-recorder--audio`). |
| `style` | `CSSProperties` | | Inline style on the root. |
| `showControls` | `boolean` | `true` | Built-in transport. Set `false` if you drive the handle yourself. |
| `showDownload` | `boolean` | `false` | Shows Download after a take. |
| `onRecordingStart` | `() => void` | | Fired when recording actually begins. |
| `onRecordingStop` | `(result: AudioRecordingResult) => void` | | Fired with the finished audio file. |
| `onRecordingPause` | `() => void` | | |
| `onRecordingResume` | `() => void` | | |
| `onError` | `(error: Error) => void` | | Permission failures, missing APIs, encode errors. |

### Handle

```tsx
const audioRef = useRef<AudioRecorderHandle>(null);

await audioRef.current?.start();
audioRef.current?.pause();
audioRef.current?.resume();
const result = await audioRef.current?.stop();
audioRef.current?.download("take.webm");
audioRef.current?.getLastRecording();
```

| Method | Description |
| --- | --- |
| `start()` | Request the microphone and start recording. |
| `stop()` | Stop and return the `AudioRecordingResult`, or `null` if nothing was captured. |
| `pause()` / `resume()` | Pause the encoder without finishing the file. |
| `download(filename?)` | Save the last take. |
| `getLastRecording()` | Last `AudioRecordingResult`, or `null`. |

`AudioRecordingResult`: `{ blob, mimeType, filename, durationMs }`.

## VideoEditor

```tsx
<VideoEditor
  sources={[{ file: recordingBlob, name: "Take 1", durationMs }]}
  onExport={(result) => {
    // result.blob is the edited file
  }}
/>
```

You can also skip `sources` and call `addSource` on the handle (including from `onRecordingStop`). Dropping a video file onto the editor has the same effect. The `sources` prop is ingested when it changes. Pass a stable `id` or the same `Blob` instance if that array is recreated on render, or you will append duplicate clips.

### Behavior

- Timeline clips are the in/out range of a source. Trim either edge; split at the playhead; drag to reorder. Neighbor cuts and the playhead snap magnetically.
- Preview plays through clips in order. Hover (or focus) the preview for play/pause. Click the ruler or drag the playhead to scrub.
- Zoom with `−` / `=` / `0`, the zoom controls, pinch, or ⌘/Ctrl+scroll. Trimming while zoomed keeps the layout still so the handle you grabbed does not jump.
- Clips with audio get a translucent waveform after ingest (decoded once per source).
- Export encodes in the browser (MP4 when WebCodecs allows it, otherwise WebM) and calls `onExport`. Progress is shown on the Export button.

Keyboard shortcuts apply only after the editor was last clicked, or while focus is inside it, and never while typing in a field.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Scrub ~1 frame (Shift: 1s) |
| Home / End | Jump to start / end |
| ↑ / ↓ | Select previous / next clip |
| S | Split at the playhead |
| Delete / Backspace | Remove the selected clip |
| ⌘/Ctrl+Z | Undo |
| ⌘/Ctrl+Shift+Z or ⌘/Ctrl+Y | Redo |
| `-` / `=` / `0` | Zoom out / in / fit |

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | | Extra class on the root (`.rmt-editor`). |
| `style` | `CSSProperties` | | Inline style on the root. |
| `sources` | `EditorInput[]` | | Initial (and later) files to ingest. |
| `showOpenFile` | `boolean` | `false` | Shows an Open file control. |
| `showDownload` | `boolean` | `false` | Shows Download after a successful export. |
| `exportLabel` | `string` | `"Export"` | Text on the encode button. While encoding, a percent is appended (`Export 40%`). |
| `downloadLabel` | `string` | `"Download"` | Accessible name for the optional Download icon. |
| `onExport` | `(result: ExportResult) => void` | | Fired with the encoded file. |
| `onChange` | `(clips: EditorClip[]) => void` | | Timeline after trim, split, reorder, delete, undo. |
| `onError` | `(error: Error) => void` | | Unreadable files, export failures. |

`EditorInput`: `{ file: Blob; id?: string; name?: string; durationMs?: number; width?: number; height?: number }`.

`EditorClip`: `{ id, sourceId, inMs, outMs, volume?, muted?, fadeInMs?, fadeOutMs? }` — half-open range on the source. Audio fields are optional; omitted volume is unity. `VideoEditor` ignores them until a later release.

### Handle

```tsx
const editorRef = useRef<VideoEditorHandle>(null);

await editorRef.current?.addSource(blob, "Take 1");
editorRef.current?.split();
editorRef.current?.deleteSelected();
editorRef.current?.undo();
editorRef.current?.redo();
const exported = await editorRef.current?.exportVideo();
editorRef.current?.download();
```

| Method | Description |
| --- | --- |
| `addSource(input, name?)` | `EditorInput` or a `Blob`. Probes the file if duration/size are omitted. |
| `split()` | Cut the selected (or playhead) clip in two. |
| `deleteSelected()` | Remove the selected clip. |
| `undo()` / `redo()` | Timeline history (trims coalesce while you drag). |
| `exportVideo()` | Encode and return `ExportResult`, or `null` if there is nothing to export. |
| `download(filename?)` | Save the last export (runs export first if needed). |

`ExportResult` has the same shape as `RecordingResult`: `{ blob, mimeType, filename, durationMs, width, height }`.

## AudioEditor

```tsx
<AudioEditor
  sources={[{ file: recordingBlob, name: "Take 1", durationMs }]}
  onExport={(result) => {
    // result.blob is the edited audio file
  }}
/>
```

Ingest from `AudioRecorder` with `addSource`, drop an audio file, or use Open file. The `sources` prop follows the same identity rules as `VideoEditor`.

### Behavior

- Timeline, trim, split, reorder, undo/redo, and zoom match `VideoEditor`. Drag the inner handles on a clip to set linear fade in / fade out (each fade is capped at half the clip).
- The stage is a waveform of the clip under the playhead, not a video well. Hover (or focus) for play/pause. Preview applies the selected clip’s gain, mute, and fades through the Web Audio API.
- Selected-clip mixer: **Mute** (M), **Gain** (0–200%), and **Normalize** (one-shot; sets gain so the clip peaks near −1 dBFS, up to 200%).
- Export encodes audio only (M4A when WebCodecs allows AAC, otherwise WebM) and calls `onExport`. `ExportResult.width` / `height` are `0`.

Keyboard shortcuts match `VideoEditor`, plus **M** to mute or unmute the selected clip.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `className` | `string` | | Extra class on the root (`.rmt-editor.rmt-editor--audio`). |
| `style` | `CSSProperties` | | Inline style on the root. |
| `sources` | `EditorInput[]` | | Initial (and later) files to ingest. |
| `showOpenFile` | `boolean` | `false` | Shows an Open file control. |
| `showDownload` | `boolean` | `false` | Shows Download after a successful export. |
| `exportLabel` | `string` | `"Export"` | Text on the encode button. While encoding, a percent is appended. |
| `downloadLabel` | `string` | `"Download"` | Accessible name for the optional Download icon. |
| `onExport` | `(result: ExportResult) => void` | | Fired with the encoded file. |
| `onChange` | `(clips: EditorClip[]) => void` | | Timeline after trim, split, fade, gain, mute, reorder, delete, undo. |
| `onError` | `(error: Error) => void` | | Unreadable files, export failures. |

### Handle

```tsx
const editorRef = useRef<AudioEditorHandle>(null);

await editorRef.current?.addSource(blob, "Take 1");
editorRef.current?.split();
editorRef.current?.deleteSelected();
editorRef.current?.undo();
editorRef.current?.redo();
await editorRef.current?.normalizeSelected();
const exported = await editorRef.current?.exportAudio();
editorRef.current?.download();
```

| Method | Description |
| --- | --- |
| `addSource(input, name?)` | `EditorInput` or a `Blob`. Probes the file if duration is omitted. |
| `split()` | Cut the selected (or playhead) clip in two. Fades stay on the outer edges. |
| `deleteSelected()` | Remove the selected clip. |
| `undo()` / `redo()` | Timeline history (trims, fades, and gain drags coalesce while you drag). |
| `normalizeSelected()` | Set gain from the clip’s sample peak. Unmutes. |
| `exportAudio()` | Encode and return `ExportResult`, or `null` if there is nothing to export. |
| `download(filename?)` | Save the last export. |

## Theming

Both video and audio recorders, and both editors, default to **dark**. Set `data-theme="light"` or `data-theme="dark"` on **any ancestor** (typically `<html>` or a layout wrapper). The nearest themed ancestor wins. With no attribute, the UI stays dark.

```html
<html data-theme="light">
```

```tsx
<div data-theme="light">
  <VideoEditor />
</div>
```

There is no `theme` prop. Do not put `data-theme` on `<VideoEditor />` / `<AudioEditor />` / `<VideoRecorder />` / `<AudioRecorder />` itself — those props are not forwarded to the DOM.

Colors, radii, and type live on CSS variables. Override them on `.rmt-recorder` / `.rmt-editor` (or a parent that the components inherit from). The video well (`--rmt-stage-bg`) stays dark in both palettes so overlays stay readable.

```css
.rmt-recorder,
.rmt-editor {
  --rmt-accent: #e2a15a;
  --rmt-radius: 16px;
  --rmt-font: "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
}
```

Full token list (including light/dark defaults): [docs/theming.md](docs/theming.md).

## Helpers and types

These are also exported from the package root:

| Export | Description |
| --- | --- |
| `detectCapabilities()` | Feature flags and user-facing `notes` for camera, screen, mic, system audio, and recording. |
| `pickMimeType({ audio?: boolean })` | Best `MediaRecorder` MIME for a **video** take. `audio: false` prefers a video-only type. |
| `pickAudioMimeType()` | Best `MediaRecorder` MIME for an **audio** take (`audio/webm` or `audio/mp4`). |
| `extensionForMime(mime)` | `"webm"`, `"mp4"`, `"m4a"`, `"ogg"`, or `"mp3"`. |

Useful types: `RecordingResult`, `AudioRecordingResult`, `ExportResult`, `EditorInput`, `EditorClip`, `CameraOverlay`, `SourceName`, `RecorderStatus`, `BrowserCapabilities`, `VideoRecorderHandle`, `VideoRecorderProps`, `AudioRecorderHandle`, `AudioRecorderProps`, `VideoEditorHandle`, `VideoEditorProps`, `AudioEditorHandle`, `AudioEditorProps`.

## Browser support

| | Chrome / Edge (desktop) | Firefox | Safari | iOS |
| --- | --- | --- | --- | --- |
| Camera + mic | Yes | Yes | Yes | Yes (Safari) |
| Screen | Yes | Yes | macOS | No |
| System audio | Yes, when sharing audio | No | No | No |
| Record video | WebM (VP8/VP9) | WebM | MP4 when the encoder exists | Limited |
| Record audio | WebM (Opus) | WebM (Opus) | M4A when the encoder exists | Limited |
| Edit / export | WebCodecs | WebCodecs | Safari 16.4+ | Safari 16.4+ |

The recorder degrades in the UI when a mode is missing. Editors need WebCodecs for export; ingest uses Mediabunny plus an `<video>` / `<audio>` fallback when a container is unfamiliar.

## SSR

The components use `window`, `navigator.mediaDevices`, and canvas. Render them only on the client (a Next.js Client Component, `dynamic(..., { ssr: false })`, or any equivalent). Importing the CSS on the server is fine.

## Demo

```bash
npm install
npm run dev
```

The demo at the repo root is a Vite app (`demo/`) with the video recorder, audio recorder, editor, and a Dark / Light toggle (`data-theme` on `<html>`). See [docs/development.md](docs/development.md) for the library build and tests.

```bash
npm test
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for released versions.

## License

MIT. See [LICENSE](LICENSE).
