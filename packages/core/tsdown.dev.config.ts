import { defineConfig } from "tsdown";

// Diagnostics-wired build, resolved through the "development" export condition.
// Types are emitted by the default build only; this pass reuses them.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    machine: "src/machine.ts",
    ports: "src/ports.ts",
    diagnostics: "src/diagnostics.ts",
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
