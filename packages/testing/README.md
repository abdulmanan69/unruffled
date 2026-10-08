# @unruffled/testing

Deterministic test utilities for [unruffled](https://github.com/abdulmanan69/unruffled).

A library whose value is correct timing cannot be allowed to fail at timing, and a suite that
sleeps will not catch it. Everything here exists so that "the spinner does not appear before
150ms", "the second click was swallowed" and "exactly one announcement reached the live region"
are ordinary assertions.

```sh
pnpm add -D @unruffled/testing
```

```ts
import { createTestPorts, flushMicrotasks } from "@unruffled/testing";

const ports = createTestPorts();

render(<SaveButton options={{ ports }} />);
await user.click(screen.getByRole("button"));

expect(screen.getByRole("button")).not.toHaveAttribute("data-pending");
act(() => ports.clock.advance(150));
expect(screen.getByRole("button")).toHaveAttribute("data-pending", "");

expect(ports.announcer.announcements).toEqual([
  { message: "Customer saved", politeness: "polite" },
]);
```

## What is in here

|                            |                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFakeClock`          | Timers you drive by hand. Timers scheduled during an advance are honoured, and `now()` reports each firing time, so elapsed-time maths inside a machine stays correct. |
| `createRecordingAnnouncer` | Every announcement with its politeness, plus `setLive(false)` to simulate a missing live region and exercise `UX1003`.                                                 |
| `createScriptedNavigation` | Simulate a leave or a blocked exit, and assert a deferred write was flushed.                                                                                           |
| `createFakeDoc`            | Listener counts and a settable `activeElement`, so teardown and focus restoration are assertable.                                                                      |
| `createTestPorts`          | All of the above, wired together.                                                                                                                                      |
| `flushMicrotasks`          | Lets queued promise callbacks run between advancing the clock and asserting.                                                                                           |

MIT © Abdul Manan
