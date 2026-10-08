/**
 * DOM-backed port implementations.
 *
 * This is the only file in the library that is allowed to touch a global. Everything else
 * receives capabilities, which is what keeps core testable in Node and reduces a future Vue
 * or Svelte adapter to a mechanical port of this one file.
 *
 * The non-obvious decisions here all concern *which* document:
 *
 * - Listeners and focus reads are scoped to an owning root rather than the global
 *   `document`. A component inside a shadow root or a popped-out window is otherwise broken
 *   in ways that are extremely hard to diagnose, and that bug class has sat open in major
 *   libraries for years.
 * - `activeElement` descends through shadow roots. The global `document.activeElement`
 *   reports the shadow *host*, not the focused control inside it, so focus restoration
 *   silently targets the wrong element.
 */

import { resolvePorts, type FocusTarget, type Ports, type StoragePort } from "@unruffled/core";
import { announce, isLive } from "./liveRegion.js";

/** What a port set is scoped to. A shadow root is as valid as a document. */
export type PortRoot = Document | ShadowRoot;

export interface DomPortOptions {
  /** Owning document or shadow root. Defaults to the ambient document. */
  readonly root?: PortRoot;
}

function ownerDocument(root: PortRoot | undefined): Document | null {
  if (root) return root instanceof Document ? root : root.ownerDocument;
  return typeof document === "undefined" ? null : document;
}

/**
 * The deepest focused element, descending into shadow roots.
 *
 * `document.activeElement` stops at a shadow host, so without this a focus read inside a web
 * component returns the wrapper rather than the control.
 */
function deepActiveElement(root: PortRoot | Document | null): Element | null {
  let active = root?.activeElement ?? null;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

/**
 * `localStorage` that cannot throw.
 *
 * Access throws outright in a sandboxed frame and in Safari private browsing, and a UX
 * library must degrade to forgetting things rather than crashing the page.
 */
function createStorage(): StoragePort {
  const area = (): Storage | null => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  };

  return {
    get: (key) => {
      try {
        return area()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set: (key, value) => {
      try {
        area()?.setItem(key, value);
      } catch {
        // Quota exceeded or storage blocked. Losing a preference is acceptable; throwing is not.
      }
    },
    remove: (key) => {
      try {
        area()?.removeItem(key);
      } catch {
        // See above.
      }
    },
  };
}

/** Builds the full DOM port set, falling back to the inert defaults wherever the DOM is absent. */
export function createDomPorts(options: DomPortOptions = {}): Ports {
  const root = options.root;
  const doc = ownerDocument(root);
  const win = doc?.defaultView ?? null;

  if (!doc || !win) {
    // Server render: core supplies inert implementations, so hooks mount without branching.
    return resolvePorts();
  }

  const listenRoot: EventTarget = root ?? doc;

  return resolvePorts({
    clock: {
      now: () => win.performance.now(),
      after: (ms, fn) => {
        const id = win.setTimeout(fn, ms);
        return () => {
          win.clearTimeout(id);
        };
      },
      frame: (fn) => {
        const start = win.performance.now();
        const state = { live: true };
        let handle = win.requestAnimationFrame(function tick() {
          if (!state.live) return;
          fn(win.performance.now() - start);
          handle = win.requestAnimationFrame(tick);
        });
        return () => {
          state.live = false;
          win.cancelAnimationFrame(handle);
        };
      },
    },

    scheduler: {
      microtask: (fn) => {
        win.queueMicrotask(fn);
      },
      idle: (fn) => {
        const handle = win.requestIdleCallback(fn);
        return () => {
          win.cancelIdleCallback(handle);
        };
      },
    },

    storage: createStorage(),

    navigation: {
      /**
       * Fires on the two events that actually precede a page going away.
       *
       * `pagehide` is the reliable one: `beforeunload` is skipped when a tab is discarded or
       * when the page enters the back-forward cache, and `unload` is unreliable on mobile.
       * `visibilitychange` to hidden is the only signal a backgrounded mobile tab gives
       * before it may never run script again.
       */
      onLeave: (handler) => {
        const onPageHide = (): void => {
          handler("pagehide");
        };
        const onVisibility = (): void => {
          if (doc.visibilityState === "hidden") handler("pagehide");
        };
        win.addEventListener("pagehide", onPageHide);
        doc.addEventListener("visibilitychange", onVisibility);
        return () => {
          win.removeEventListener("pagehide", onPageHide);
          doc.removeEventListener("visibilitychange", onVisibility);
        };
      },

      // Real listeners on real events, so a window held by an undoable is genuinely flushed
      // on the way out and UX1007 stays quiet.
      flushable: () => true,

      /**
       * Covers the browser-level exit only.
       *
       * A native `beforeunload` prompt cannot be styled or customised, and in-app route
       * changes never reach it. Router blocking is a separate binding layered on top; this
       * is the floor, not the whole feature.
       */
      block: (shouldBlock, onBlocked) => {
        const onBeforeUnload = (event: BeforeUnloadEvent): void => {
          if (!shouldBlock()) return;
          event.preventDefault();
          // The browser shows its own prompt, so there is no proceed or cancel to report.
          onBlocked(
            () => {},
            () => {},
          );
        };
        win.addEventListener("beforeunload", onBeforeUnload);
        return () => {
          win.removeEventListener("beforeunload", onBeforeUnload);
        };
      },

      /**
       * The only transport that survives an unloading document.
       *
       * A normal `fetch` issued from `pagehide` is cancelled when the document goes away,
       * which is exactly how a deferred write inside an undo window gets lost.
       */
      beacon: (url, body) => {
        try {
          return win.navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        } catch {
          // Blocked by a Content-Security-Policy connect-src, or the payload exceeded the
          // user-agent limit. Reporting false lets the caller fall back to a blocking flush.
          return false;
        }
      },
    },

    doc: {
      activeElement: () => {
        const element = deepActiveElement(root ?? doc);
        // The body being focused means focus was lost, not that the body is a target.
        if (element === null || element === doc.body) return null;
        return element as unknown as FocusTarget;
      },
      listen: (type, handler, listenOptions) => {
        const wrapped = (event: Event): void => {
          handler(event);
        };
        listenRoot.addEventListener(type, wrapped, listenOptions);
        return () => {
          listenRoot.removeEventListener(type, wrapped, listenOptions);
        };
      },
      isHidden: () => doc.visibilityState === "hidden",
    },

    announcer: { announce, live: isLive },
  });
}
