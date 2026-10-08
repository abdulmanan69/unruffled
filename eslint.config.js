import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/node_modules/**",
    "**/.astro/**",
    "**/coverage/**",
    // The documentation site is type-checked by `astro check`, which understands
    // .astro files and Astro globals. Pointing the library config at it too would
    // mean a second tsconfig project for no additional coverage.
    "apps/**",
    "examples/**",
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // This config file is not part of any tsconfig include, by design.
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, __DEV__: "readonly" },
    },
    rules: {
      // The library ships no classes and no enums; both are erasable-syntax hazards and
      // enlarge output. Keep the surface to functions, types and plain data.
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a union of string literals; enums are not erasable and do not tree-shake.",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      // Index access on a parsed JSON payload is the honest spelling: the key may not be
      // there, and dot notation on an index signature reads as though it is guaranteed.
      "@typescript-eslint/dot-notation": ["error", { allowIndexSignaturePropertyAccess: true }],
      // A no-op arrow is how an inert port implementation is written. The rule still guards
      // empty named functions and class methods, which are the cases that signal an oversight.
      "@typescript-eslint/no-empty-function": ["error", { allow: ["arrowFunctions"] }],
      "no-param-reassign": "error",
    },
  },

  {
    // Library source: no logging, no DOM globals assumed, no dependency on the host app.
    files: ["packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        { name: "window", message: "Reach the DOM through an injected port so core stays testable in Node." },
        {
          name: "document",
          message: "Use the doc port; direct document access breaks shadow DOM and multi-window.",
        },
      ],
    },
  },

  {
    // The diagnostics bus exists to write to the console, and the doc port exists to touch the document.
    files: [
      "packages/devtools/src/**/*.ts",
      "packages/core/src/diagnostics/**/*.ts",
      // The adapter directory is where DOM access belongs; that is the point of the layer.
      "packages/react/src/adapter/**/*.{ts,tsx}",
      "packages/testing/src/**/*.{ts,tsx}",
    ],
    rules: { "no-console": "off", "no-restricted-globals": "off" },
  },

  {
    files: ["packages/react/src/**/*.{ts,tsx}", "packages/testing/src/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
    },
  },

  {
    files: ["packages/*/test/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-restricted-globals": "off",
      "no-console": "off",
      // Real HTTP clients reject with plain objects, not Errors. Normalising exactly those
      // payloads is what this library does, so the fixtures have to be shaped like them.
      "@typescript-eslint/prefer-promise-reject-errors": "off",
      // `void` as the "this action takes no arguments" type argument is correct and reads
      // better than `undefined` at a call site.
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },

  {
    files: ["*.config.{ts,js,mjs}", "eslint.config.js", "vitest.config.ts", "packages/*/tsdown*.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/explicit-module-boundary-types": "off" },
  },
]);
