import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    action: "src/action.ts",
    failure: "src/failure.ts",
    announce: "src/announce.ts",
    r19: "src/r19.ts",
  },
  format: ["esm"],
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
