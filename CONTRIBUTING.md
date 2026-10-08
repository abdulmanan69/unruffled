# Contributing

Thanks for looking. This document covers how to run the repository, the house rules the code
follows, and — the part worth reading before you open an issue — what this library will refuse
to build.

## Setup

Node 20.19 or newer, and pnpm 12.

```sh
pnpm install
pnpm verify
```

`verify` is the whole gate, in the order CI runs it:

```
format:check → lint → typecheck → test → build → publint → attw → size → docs:check → docs:build
```

If that passes locally it passes in CI. If it does not, CI is not the place to find out.

Useful during development:

```sh
pnpm test:watch        # vitest in watch mode
pnpm docs:dev          # the documentation site, at /unruffled/
pnpm size              # the committed bundle budgets
```

The documentation site resolves the library from source, so a change to a hook shows up in the
playground without a build step in between.

## The shape of the codebase

```
packages/core      machines and ports. No framework, no globals, no DOM, no dependencies.
packages/react     hooks and prop-getters. React is a peer.
packages/testing   deterministic ports: fake clock, recording announcer, scripted navigation.
apps/docs          the documentation site and playground.
```

A behaviour lives in `core` as a machine, and `react` binds it. If you find yourself writing
timing logic inside a hook, it probably belongs in a machine.

## House rules

These are enforced by lint and by review, and each one is here because of a specific defect.

**Nothing in `core` touches a global.** No `window`, no `document`, no `setTimeout`.
Capabilities arrive through the eight ports. This is what makes timed behaviour testable with
a counter instead of a sleep, and it is why `packages/react/src/adapter/domPorts.ts` is the
only file allowed near the DOM.

**Function members of an interface are properties, not method shorthand.** Write
`readonly announce: (message: string) => void`, never `announce(message: string): void`. These
are closures; declaring them as methods means destructuring one trips `unbound-method`, and
property syntax is contravariant in its parameters, which is stricter.

**No non-null assertions.** Narrow instead. `queue.shift()!` is banned; check for `undefined`.

**No enums and no classes.** Both are non-erasable and neither tree-shakes.

**`exactOptionalPropertyTypes` is on.** Never write `{ x: undefined }` into an optional field.
Build objects with conditional spreads, the way `machines/action/machine.ts` does.

**Every diagnostics call is wrapped in `if (__DEV__)`.** The call and its arguments have to be
removable, not merely dead.

**Timing is asserted, never slept through.** A test that calls `setTimeout` to wait for
behaviour will be sent back. Use the fake clock from `@unruffled/testing` and advance it.

**Comments say why, not what.** The bar is the comments already in
`packages/core/src/machines/action/machine.ts`: each one names the specific failure the line
below prevents. A comment that restates its code is worse than no comment.

## Accessibility is not a review category

It is the acceptance criterion. A change that adds an interactive affordance needs, in the
same pull request:

- a keyboard path, tested explicitly;
- correct ARIA state, tested by attribute rather than by eye;
- an announcement where an outcome changes, and a test that **exactly one** reached the live
  region;
- no `disabled` on anything the user might be focused on.

If a change makes one of those harder, that is the thing to discuss in the issue, before the
code.

## Changesets

Every change that affects a published package needs one:

```sh
pnpm changeset
```

Pick the packages, pick the bump, and write the entry for someone reading the changelog later,
not for the reviewer reading the diff. "Fixed a bug" helps nobody.

Documentation-only and tooling-only changes do not need a changeset.

## What this library will not build

This is the most useful section. The scope was chosen from a survey of the React component
ecosystem, and these tiers are not gaps — they are solved and defended by ten to a hundred
times the distribution any new entrant could get. A pull request adding one of them will be
declined, politely and quickly:

- buttons, cards, inputs, badges, avatars, separators
- dialogs, drawers, sheets, popovers, tooltips, menus
- toast renderers
- command palettes
- date pickers and calendars
- data tables and grids
- skeleton shapes and spinners
- icon packs, theme kits, design systems
- onboarding tour rendering
- animation runtimes

**The library emits no CSS and renders no pixels.** That is a permanent constraint, not a
current state. `<Announcer>` is the only component, and it renders two clipped live regions
that are never seen. A request to "also ship a styled `<LoadingButton>`" will be declined: a
styled competitor in that tier is dead on arrival, while a headless hook serves every design
system at once.

Four adjacent things are deliberately out of scope even though they look defensible:

- **Tour lifecycle** — two healthy MIT libraries already own it.
- **Async combobox** — the most saturated surface in React.
- **Skeleton auto-sizing** — the leader is dead and `animate-pulse` is free.
- **An offline mutation queue** — that is a durable, ordered, conflict-aware persistence
  project, and the data layers already pause offline mutations.

What _is_ in scope is on the [roadmap](https://abdulmanan69.github.io/unruffled/roadmap/). If
you want to help, the primitives listed there are the place to start, and opening an issue to
agree the API before writing it will save you a rewrite.

## Reporting a bug

A reproduction beats a description. The playground is usually the fastest one: configure the
failure there, and paste the configuration it prints back to you.

Include what you expected, what happened, and any `UX####` code the console reported.

## Code of conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Contributions are accepted under the [MIT licence](LICENSE).
