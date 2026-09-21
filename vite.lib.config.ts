import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "ReactMediaTools",
      fileName: "index",
      formats: ["es"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "mediabunny"],
      output: {
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "styles.css" : asset.name ?? "[name][extname]",
      },
    },
    cssCodeSplit: true,
    emptyOutDir: false,
  },
});
