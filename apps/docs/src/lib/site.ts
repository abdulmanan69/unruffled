/**
 * Site metadata and the base-path helper.
 *
 * GitHub Pages serves a project site from a subdirectory, so every internal URL has to be
 * built from `import.meta.env.BASE_URL`. A hardcoded `/installation/` works in `astro dev`
 * and 404s in production, which is the most common way a Pages deployment breaks, and it
 * breaks silently. {@link href} is the only way this site writes an internal link.
 */

export const SITE = {
  name: "unruffled",
  tagline: "The eleven seconds after the click.",
  description:
    "A headless React layer for the async half of your UI: guard, pending, confirm, undo, rollback, retry, partial failure and screen-reader announcements. 7 kB, zero dependencies, zero CSS. It composes over the component library you already have.",
  repo: "https://github.com/abdulmanan69/unruffled",
  npm: "https://www.npmjs.com/package/@unruffled/react",
  origin: "https://abdulmanan69.github.io",
} as const;

const BASE = import.meta.env.BASE_URL;

/**
 * Builds an internal URL.
 *
 * Always returns a trailing slash, matching `trailingSlash: "always"` in the Astro config,
 * so a link never triggers a redirect.
 */
export function href(path = ""): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  const rest = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return rest.length === 0 ? `${base}/` : `${base}/${rest}/`;
}

/**
 * Builds a URL for a file in `public/`.
 *
 * Separate from {@link href} because that one appends a trailing slash to match the route
 * format, and `/favicon.svg/` is not a file. Getting this wrong produces a 404 that only
 * appears in the production build, where the asset silently stops loading.
 */
export function asset(path: string): string {
  const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
  return `${base}/${path.replace(/^\/+/, "")}`;
}

/** Builds an absolute URL, for canonical and Open Graph tags. */
export function absolute(path = ""): string {
  return `${SITE.origin}${href(path)}`;
}

/** Absolute URL for a file in `public/`, for Open Graph image tags. */
export function absoluteAsset(path: string): string {
  return `${SITE.origin}${asset(path)}`;
}

export interface NavLink {
  readonly label: string;
  readonly path: string;
  /** Shown in the sidebar under the link. Omitted for short, self-evident entries. */
  readonly hint?: string;
}

export interface NavSection {
  readonly title: string;
  readonly links: readonly NavLink[];
}

/**
 * The documentation navigation.
 *
 * Ordered as a reader would meet it: why it exists, how to install it, then the primitives,
 * then the cross-cutting concerns. Diagnostics is last because it is reference material you
 * arrive at from a console message rather than something you read through.
 */
export const NAV: readonly NavSection[] = [
  {
    title: "Start",
    links: [
      { label: "Overview", path: "" },
      { label: "Installation", path: "installation" },
      { label: "Getting started", path: "getting-started" },
      { label: "Playground", path: "playground", hint: "Drive every state by hand" },
    ],
  },
  {
    title: "Primitives",
    links: [
      { label: "useAction", path: "components/use-action", hint: "The action lifecycle" },
      { label: "useFailure", path: "components/use-failure", hint: "Failure taxonomy" },
      { label: "Announcer", path: "components/announcer", hint: "Live regions" },
    ],
  },
  {
    title: "Concerns",
    links: [
      { label: "Accessibility", path: "accessibility" },
      { label: "Animation", path: "animation" },
      { label: "Theming", path: "theming" },
      { label: "Patterns", path: "patterns" },
      { label: "Examples", path: "examples" },
    ],
  },
  {
    title: "Reference",
    links: [
      { label: "API", path: "api" },
      { label: "Diagnostics", path: "diagnostics", hint: "UX1001 to UX1009" },
      { label: "Roadmap", path: "roadmap" },
    ],
  },
];

/** The top-level links in the masthead. */
export const TOP_NAV: readonly NavLink[] = [
  { label: "Docs", path: "getting-started" },
  { label: "Playground", path: "playground" },
  { label: "Diagnostics", path: "diagnostics" },
];
