import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (name: string, entry = "index.ts") =>
  fileURLToPath(new URL(`./packages/${name}/src/${entry}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Subpath aliases must precede the bare specifier: the first match wins.
      "@unruffled/core/diagnostics": pkg("core", "diagnostics.ts"),
      "@unruffled/core/machine": pkg("core", "machine.ts"),
      "@unruffled/core/ports": pkg("core", "ports.ts"),
      "@unruffled/core": pkg("core"),
      "@unruffled/react": pkg("react"),
      "@unruffled/query": pkg("query"),
      "@unruffled/form": pkg("form"),
      "@unruffled/devtools": pkg("devtools"),
      "@unruffled/testing": pkg("testing"),
      "@unruffled/intl": pkg("intl"),
    },
  },
  define: {
    // Tests always run with diagnostics on: the rule table is part of the contract under test.
    __DEV__: "true",
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["packages/*/test/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["packages/*/src/**/*.d.ts", "packages/eslint-plugin/**"],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
