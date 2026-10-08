# @unruffled/react

**The eleven seconds after the click.**

React hooks and prop-getters for the async half of your UI. It renders nothing: no CSS, no
widgets, no design system. You get values, `data-*` attributes and props you spread onto your
own markup, so it composes over whatever component library you already use.

[Documentation](https://abdulmanan69.github.io/unruffled/) ·
[Playground](https://abdulmanan69.github.io/unruffled/playground/) ·
[Source](https://github.com/abdulmanan69/unruffled)

```sh
pnpm add @unruffled/react
```

```tsx
import { useAction, Announcer } from "@unruffled/react";

const save = useAction(() => api.saveCustomer(form), {
  key: `customer:${id}`,
  announce: { success: "Customer saved" },
  onError: setFailure,
});

<button {...save.triggerProps}>{save.pending ? "Saving" : "Save customer"}</button>;

// Once, near the root.
<Announcer />;
```

That button refuses the second click **synchronously**, contends with any other component
writing the same record, shows nothing for the first 150ms so a fast save never flashes, keeps
the affordance up for 400ms once shown so a slow one never flickers, aborts on unmount,
classifies the failure, and announces the outcome.

It is never `disabled`. A disabled element leaves the tab order, so disabling a button at the
moment it is pressed throws the user's focus to the top of the document.

## What is in 0.1.0

|                           |                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `useAction`               | The action lifecycle: guard, pending thresholds, abort, retry, announcement.                |
| `useFailure`              | Ten failure kinds from whatever your API rejected with, and a live `Retry-After` countdown. |
| `<Announcer>`             | Two live regions and a queue that makes a repeated message announce at all.                 |
| `UnruffledProvider`       | Optional application-wide defaults.                                                         |
| `usePrefersReducedMotion` | Subscribed, not snapshotted.                                                                |

**7.08 kB brotli installed, including `@unruffled/core`. Zero runtime dependencies.**

React 18 or 19 as a peer. ESM only. Chrome and Edge 111+, Firefox 115+, Safari 17+.

## Diagnostics

In development, a bus warns with stable codes when a call site is unsafe — a destructive action
with no recovery path, a long pending state with no live region mounted, an unhandled failure.
Production builds contain none of it.

[The nine rules](https://abdulmanan69.github.io/unruffled/diagnostics/).

MIT © Abdul Manan
