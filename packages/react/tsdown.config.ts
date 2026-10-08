import { defineConfig } from "tsdown";

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
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  unbundle: false,
  define: { __DEV__: "false" },
  outputOptions: {
    entryFileNames: "[name].js",
    chunkFileNames: "chunks/[name]-[hash].js",
  },
});
