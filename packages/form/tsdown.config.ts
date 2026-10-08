import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
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
