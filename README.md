<div align="center">

# unruffled

**The eleven seconds after the click.**

Your component library ships the button. unruffled ships everything that happens next:
the duplicate-click guard, the spinner that does not flash, the failure that knows whether
it can be retried, and the announcement a screen-reader user actually hears.

[Documentation](https://abdulmanan69.github.io/unruffled/) ·
[Playground](https://abdulmanan69.github.io/unruffled/playground/) ·
[Diagnostics](https://abdulmanan69.github.io/unruffled/diagnostics/)

</div>

---

## The problem

Press Save. Something happens for two seconds. Those two seconds are where applications are
actually judged, and no component library ships them.

This is measurable, so it was measured before a line of this library was written. Across all
61 components in the shadcn/ui registry:

| Searched for                                   | Occurrences |
| ---------------------------------------------- | ----------- |
| `aria-live`                                    | **0**       |
| `useActionState`, `useTransition`, `isPending` | **0**       |
| `AbortController`                              | **0**       |
| `retry`                                        | **0**       |
| `useOptimistic` (across 316 doc pages)         | **0**       |

It is not a shadcn problem. `<Button loading>` does not exist in Radix either, and MUI has had
the request open since 2023 under "waiting for 👍". The `Undo` in most toast libraries is a
button with no timer, attached to a mutation that already landed.

So every team writes this by hand, and almost every hand-written version has the same five
defects.

## Why it exists

Not to be another component library. Buttons, cards, dialogs, toasts, command palettes, date
pickers and data grids are solved several times over and defended by ten to a hundred times
the distribution. **unruffled will never build any of them.**

It does one thing: the lifecycle of an action.

```
idle ──► busy ──► settling ──► success
            │                └─► error ──► backoff ──► busy
            └─ nothing is shown yet
```

It renders nothing. No CSS, no widgets, no design system. It hands you values, `data-*`
attributes and props you spread onto your own markup, so it composes over whatever you
already use.

## Install

```sh
pnpm add @unruffled/react
```

`@unruffled/core` comes with it. React 18 or 19 is a peer dependency.

## Quick start

```tsx
import { useAction, Announcer } from "@unruffled/react";

function SaveCustomer({ customer }) {
  const save = useAction(() => api.saveCustomer(customer), {
    key: `customer:${customer.id}`,
    announce: { success: "Customer saved" },
    onError: (failure) => setError(failure),
  });

  return (
    <button {...save.triggerProps}>
      {save.pending ? <Spinner /> : null}
      {save.pending ? "Saving" : "Save customer"}
    </button>
  );
}

// Once, near the root of the application.
<Announcer />;
```

That button now:

- **refuses the second click synchronously**, inside the event handler, before any `await` —
  a `disabled` bound to a pending flag does not, because the flag is not set yet;
- **contends across components**, because the guard is keyed by record rather than by
  component, so a row action and a toolbar button writing `customer:42` cannot both fire;
- **shows nothing for the first 150ms**, so a fast save never flashes, and **keeps the
  affordance up for 400ms** once shown, so a slow-ish save never flickers;
- **is never `disabled`**, so the user does not lose focus to the top of the document at the
  moment they press it;
- **aborts** on unmount and on cancel;
- **classifies the failure** into one of ten kinds, with an honest answer to whether a retry
  could work;
- **announces the outcome** to assistive technology, politely on success and assertively on
  failure.

And when the action is a deletion, `useUndoable` holds the write for six seconds, so Undo
cancels a request that was never sent rather than apologising for one that already landed.

## What ships today

Version 0.1.0 is deliberately small. Everything listed is implemented, tested and measured;
nothing is half-shipped.

|                   | What it removes                                                                                                                                | Size            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **`useAction`**   | The whole action lifecycle: synchronous duplicate guard, pending thresholds, abort, retry with backoff, announcement.                          | 2.07 kB         |
| **`useFailure`**  | `err.message` as an error UX. Ten failure kinds from whatever your API rejected with, plus a live `Retry-After` countdown.                     | included        |
| **`useUndoable`** | The Undo that is a lie. A deferred write that survives navigation and unmount, coalesces repeats, and sends nothing at all if the user undoes. | 1.90 kB         |
| **`<Announcer>`** | Silence. Two live regions, a de-duplicating queue, and the trick that makes a repeated message announce at all.                                | 692 B           |
| **Diagnostics**   | Guessing. Nine stable `UX####` codes; four are reported today.                                                                                 | 0 in production |

**Installed cost: 8.25 kB brotli with everything retained, zero runtime dependencies.**

Confirmation flows, partial failure, selection descriptors and bulk actions are
designed and on the [roadmap](https://abdulmanan69.github.io/unruffled/roadmap/).

## The part that is hard to copy

Every machine emits a transition stream, and a development-only bus reads it. It does not wait
to be asked whether your wiring is sound:

```
[unruffled UX1001] Destructive action has neither a confirmation nor an undo path

An irreversible action can be triggered by a single mis-click or a stray Enter on a
focused control, and the user has no way back.

Fix: Either wrap the action in useConfirm, or give it an undo window with useUndoable.
Site: DeleteCustomerButton (src/customers/DeleteCustomerButton.tsx:24:18)
Docs: https://abdulmanan69.github.io/unruffled/diagnostics/ux1001/
```

Each rule fires when the wiring is **wrong**, never when a feature is merely switched on — a
warning that fires on correct code only teaches people to silence warnings.

Production builds contain none of it. The rule table lives on its own subpath that no
production code path imports, so the strings are not dead code behind a flag; they are not in
the module graph at all.

## Accessibility

Not a feature of this library. It is the product.

**The trigger is never `disabled`.** A disabled element leaves the tab order, so disabling a
button at the moment it is pressed throws the user's focus to the top of the document and
loses their place. The element stays focusable, reports `aria-disabled`, and refuses
activation in its handlers.

**Announcement is on by default; silence is the opt-out.** This is the inverse of the usual
default, and it is why `UX1003` exists: the library checks whether a live region is actually
mounted, so it can tell "announced correctly" from "announced into a void".

**Reduced motion is respected without being asked**, and the preference is _subscribed to_
rather than read once at mount, so turning it on mid-session takes effect. Reduction means
amplitude, not a kill switch: a countdown keeps counting, it simply stops animating.

Honest limits: the suite covers keyboard interaction and ARIA attributes in jsdom. Real
screen-reader verification across NVDA, JAWS, VoiceOver and TalkBack is on the roadmap and has
not been done. The library emits no pixels, so colour contrast, hit targets, focus-ring styling
and the labels on your own markup remain yours.
[Full accessibility notes](https://abdulmanan69.github.io/unruffled/accessibility/).

## Browser support

Chrome and Edge 111+, Firefox 115+, Safari 17+. Safari 17 is the floor because the scheduler
port uses `requestIdleCallback`.

ESM only. CommonJS consumers are not supported in 0.1.0.

## Framework support

React 18 and 19 today.

`@unruffled/core` imports no framework, touches no global and reads no DOM. Everything impure
arrives through one of eight injected ports — clock, scheduler, storage, navigation, doc,
announcer, transport, logger — which is what makes timing deterministic in tests and reduces a
Vue, Svelte or vanilla adapter to a port of one file,
[`domPorts.ts`](packages/react/src/adapter/domPorts.ts).

No other adapter is promised for 1.x. A multi-framework claim that ships one framework and
leaves the rest fifteen minors behind is worse than not making the claim.

## Repository

```
packages/core      framework-agnostic machines and ports, zero dependencies
packages/react     hooks and prop-getters, React as a peer
packages/testing   fake clock, recording announcer, scripted navigation
apps/docs          the documentation site and playground (Astro)
```

```sh
pnpm install
pnpm verify      # format, lint, typecheck, test, build, publint, attw, size budgets
pnpm docs:dev    # the documentation site at /unruffled/
```

Size budgets are committed per package, so an accidental import fails the build rather than
being noticed three releases later.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the setup, the
house rules and, importantly, the things this library will refuse to build and why.

Security reports: [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE) © Abdul Manan
