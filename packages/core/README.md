# @unruffled/core

The framework-agnostic half of [unruffled](https://github.com/abdulmanan69/unruffled).

State machines for the async half of a UI: guard, pending, retry, failure classification.
No framework, no globals, no DOM, **zero dependencies**.

You usually do not install this directly. [`@unruffled/react`](https://www.npmjs.com/package/@unruffled/react)
depends on it.

```sh
pnpm add @unruffled/core
```

## What is in here

**The machine runtime.** Flat state machines whose _structure_ is plain data and whose
_behaviour_ is a lookup table of named implementations. Serialisable, diffable, and testable in
Node. 1.49 kB brotli.

**Eight ports.** Every impure capability is injected: `clock`, `scheduler`, `storage`,
`navigation`, `doc`, `announcer`, `transport`, `logger`. Three things fall out of that: timed
behaviour is deterministic in tests, nothing reaches for a global, and shadow-DOM and
multi-window correctness is structural rather than remembered.

**`normalizeError`.** RFC 9457, JSON:API `source.pointer`, `field_errors` maps, flat
`{path, message}` lists, bare messages, fetch `TypeError` and aborts, onto one ten-kind
taxonomy with an honest `canRetry` and a parsed `Retry-After`.

**The diagnostics rule table**, on its own subpath so no production code path imports it.

## Building another adapter

This package exists so that a Vue, Svelte or vanilla adapter is a port of one file. An adapter
drives `createService`, subscribes to snapshots, and supplies DOM-backed ports; everything else
is already framework-neutral. See
[`packages/react/src/adapter/domPorts.ts`](https://github.com/abdulmanan69/unruffled/blob/main/packages/react/src/adapter/domPorts.ts)
for the reference implementation.

No adapter beyond React is promised for 1.x.

MIT © Abdul Manan
