import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

/**
 * GitHub Pages serves a project site from a subdirectory, so `base` has to be set and every
 * internal URL has to be built from `import.meta.env.BASE_URL`. A hardcoded "/docs/x" works
 * in dev and 404s in production, which is the single most common way a Pages deploy breaks.
 *
 * `trailingSlash: "always"` with `build.format: "directory"` makes the emitted paths and the
 * requested paths agree, so a link to /installation/ resolves to installation/index.html
 * rather than redirecting.
 */
export default defineConfig({
  site: "https://abdulmanan69.github.io",
  base: "/unruffled",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "auto" },
  integrations: [react(), mdx(), sitemap({ changefreq: "weekly" })],
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      // The docs app consumes the workspace source directly, so a change to a hook is
      // visible in the playground without a build step in between.
      alias: {
        "@unruffled/core/diagnostics": new URL("../../packages/core/src/diagnostics.ts", import.meta.url)
          .pathname,
        "@unruffled/core": new URL("../../packages/core/src/index.ts", import.meta.url).pathname,
        "@unruffled/react": new URL("../../packages/react/src/index.ts", import.meta.url).pathname,
      },
    },
    define: {
      // The library strips its diagnostics on `__DEV__: false`. The docs site keeps them on,
      // because the diagnostics console is part of what the site is demonstrating.
      __DEV__: "true",
    },
  },
});
