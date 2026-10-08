import { defineConfig } from "tsdown";

// Diagnostics-wired build, resolved through the "development" export condition.
// Types are emitted by the default build only; this pass reuses them.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    action: "src/action.ts",
    failure: "src/failure.ts",
    undoable: "src/undoable.ts",
    announce: "src/announce.tsx",
  },
  format: ["esm"],
  external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
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
