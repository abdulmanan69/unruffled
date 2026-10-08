import { defineConfig } from "tsdown";

// Diagnostics-wired build, resolved through the "development" export condition.
// Types are emitted by the default build only; this pass reuses them.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    "locales/en": "src/locales/en.ts",
    "locales/de": "src/locales/de.ts",
    "locales/fr": "src/locales/fr.ts",
    "locales/es": "src/locales/es.ts",
  },
  format: ["esm"],
  platform: "neutral",
  dts: false,
  clean: false,
  sourcemap: true,
  treeshake: true,
  unbundle: false,
  define: { __DEV__: "true" },
  outputOptions: {
    entryFileNames: "[name].development.js",
    chunkFileNames: "chunks/[name]-[hash].development.js",
  },
});
