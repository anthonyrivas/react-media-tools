# Theming

`@anthonyrivas/react-media-tools` styles with plain CSS. Import `@anthonyrivas/react-media-tools/styles.css`. Class names and variables use the `rmt-` prefix.

## Light and dark

The recorder and editor default to the **dark** palette.

Set `data-theme="light"` or `data-theme="dark"` on an **ancestor** of the component (for example `<html>`, `<body>`, or a layout `div`). Tokens inherit from the nearest element that defines them.

```html
<html data-theme="light">
  <!-- both components use the light palette -->
</html>
```

```tsx
<div data-theme="dark">
  <VideoRecorder />
</div>
<div data-theme="light">
  <VideoEditor />
</div>
```

`<VideoRecorder />` and `<VideoEditor />` do not forward a `data-theme` prop to the DOM. Wrap them, or set the attribute on a parent you already control.

With no `data-theme`, the components keep their built-in dark tokens.

## What to override

Put overrides on `.rmt-recorder`, `.rmt-editor`, or a parent that wraps them. Color tokens follow `data-theme`; radius, type, and spacing do not.

```css
.rmt-editor {
  --rmt-accent: #3b82f6;
  --rmt-radius: 12px;
}
```

The preview / recording well uses `--rmt-stage-bg` and stays dark in both themes so play overlays and empty-state copy stay readable. `--rmt-on-stage` / `--rmt-on-stage-muted` are the text colors on that well.

## Color tokens

Values below are the built-in palettes. `--rmt-wave-blend` is `screen` in dark mode and `normal` in light mode so waveforms stay visible on clips.

| Variable | Dark | Light | Role |
| --- | --- | --- | --- |
| `--rmt-bg` | `#12141a` | `#f3f0e8` | Component chrome |
| `--rmt-bg-elevated` | `#1b1f2a` | `#fffdf8` | Timeline well |
| `--rmt-bg-control` | `#262b39` | `#e7e2d6` | Buttons |
| `--rmt-bg-control-hover` | `#303748` | `#dcd6c8` | Button hover |
| `--rmt-fg` | `#f3f1eb` | `#1a1d27` | Primary text |
| `--rmt-fg-muted` | `#9aa3b4` | `#5c6475` | Secondary text |
| `--rmt-accent` | `#e2a15a` | `#c9843c` | Primary actions, selection |
| `--rmt-accent-strong` | `#f4b56a` | `#b8752e` | Primary hover |
| `--rmt-accent-soft` | `rgba(226, 161, 90, 0.16)` | `rgba(201, 132, 60, 0.16)` | Toggles on |
| `--rmt-danger` | `#e25d5d` | `#c63c3c` | Stop / recording badge |
| `--rmt-danger-text` | `#1a0808` | `#1a0808` | Text on danger buttons |
| `--rmt-danger-soft` | `rgba(226, 93, 93, 0.16)` | `rgba(198, 60, 60, 0.12)` | Error well |
| `--rmt-success` | `#3ecf8e` | `#1f9d68` | Reserved |
| `--rmt-border` | `rgba(243, 241, 235, 0.1)` | `rgba(26, 29, 39, 0.1)` | Hairlines |
| `--rmt-border-strong` | `rgba(243, 241, 235, 0.18)` | `rgba(26, 29, 39, 0.18)` | Clip edges |
| `--rmt-shadow` | `0 18px 50px rgba(0, 0, 0, 0.35)` | `0 18px 50px rgba(26, 29, 39, 0.1)` | Panel shadow |
| `--rmt-stage-bg` | `#090a0e` | `#090a0e` | Video well |
| `--rmt-clip` | `#3a4a63` | `#c5d0e0` | Timeline clip |
| `--rmt-clip-selected` | `#4e3a24` | `#e4c49a` | Selected clip |
| `--rmt-on-accent` | `#1a1208` | `#1a1208` | Text on primary buttons |
| `--rmt-on-stage` | `#f3f1eb` | `#f3f1eb` | Text on the video well |
| `--rmt-on-stage-muted` | `#9aa3b4` | `#9aa3b4` | Muted text on the video well |
| `--rmt-error-fg` | `#ffd4d4` | `#8a1f1f` | Error message text |
| `--rmt-overlay` | `rgba(9, 10, 14, 0.72)` | `rgba(9, 10, 14, 0.72)` | Play button, badges |
| `--rmt-overlay-strong` | `rgba(9, 10, 14, 0.84)` | `rgba(9, 10, 14, 0.84)` | Play button hover |
| `--rmt-wave-blend` | `screen` | `normal` | Waveform `mix-blend-mode` |
| `--rmt-wave-tip-alpha` | `0.18` | `0.18` | Waveform bar ends |
| `--rmt-wave-center-alpha` | `0.36` | `0.36` | Waveform bar center |
| `--rmt-trim-grip` | `rgba(0, 0, 0, 0.38)` | `rgba(26, 29, 39, 0.22)` | Clip trim handles |
| `--rmt-trim-mark` | `rgba(243, 241, 235, 0.7)` | `rgba(26, 29, 39, 0.72)` | Trim handle glyph |

## Structure tokens

These are set on `.rmt-recorder` / `.rmt-editor` and do not change with `data-theme`.

| Variable | Default | Role |
| --- | --- | --- |
| `--rmt-radius` | `16px` | Panel corners |
| `--rmt-radius-sm` | `10px` | Timeline, errors |
| `--rmt-font` | `"Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif` | UI type |
| `--rmt-mono` | `"SFMono-Regular", ui-monospace, Menlo, Consolas, monospace` | Clocks, clip times |
| `--rmt-control-height` | `36px` | Buttons and toggles |
| `--rmt-gap` | `10px` | Toolbar spacing |
| `--rmt-pip-radius` | `10px` | Camera overlay corners |

## Roots

| Class | Component |
| --- | --- |
| `.rmt-recorder` | `VideoRecorder` |
| `.rmt-editor` | `VideoEditor` |
