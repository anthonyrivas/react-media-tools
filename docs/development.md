# Development

This repository is a Vite library with a demo app at the repo root.

## Scripts

```bash
npm install
npm run dev          # demo at http://localhost:5173 (or the next free port)
npm test             # vitest once
npm run test:watch   # vitest in watch mode
npm run build        # library into dist/ (JS, d.ts, styles.css)
npm run build:demo   # static demo build
npm run preview      # preview the demo build
```

`npm run dev` aliases `@anthonyrivas/react-media-tools` to `src/`, so the demo imports match the published package name. Tests live next to the source as `*.test.ts` / `*.test.tsx` and run in jsdom; media capture is mocked.

## Layout

| Path | Role |
| --- | --- |
| `src/` | Library (`VideoRecorder`, `AudioRecorder`, `VideoEditor`, styles) |
| `src/index.ts` | Package exports |
| `src/styles.css` | Component CSS (copied to `dist/styles.css` on build) |
| `demo/` | Vite playground |
| `vite.lib.config.ts` | Library bundle |
| `vite.config.ts` | Demo |

Peer dependencies are `react` and `react-dom` (>= 18). The only runtime dependency is `mediabunny`; it is not bundled into `dist`.

## Using a local build

```bash
npm run build
```

The package `exports` point at `dist/`:

```json
".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" }
"./styles.css": "./dist/styles.css"
```

Link or pack that folder from another app the same way you would any ESM React library. Import the CSS from `@anthonyrivas/react-media-tools/styles.css`.
