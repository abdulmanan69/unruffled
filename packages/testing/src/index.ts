/**
 * `@unruffled/testing` — deterministic harnesses for timed, async UX.
 *
 * A library whose whole value is correct timing cannot be allowed to fail at timing, and a
 * suite that sleeps will not catch it. Everything here exists so that "the spinner does not
 * appear before 150ms", "the second click was swallowed" and "exactly one announcement
 * reached the live region" are ordinary assertions.
 */

export { createFakeClock, flushMicrotasks, type FakeClock } from "./fakeClock.js";

export {
  createFakeDoc,
  createFocusTarget,
  createMemoryStorage,
  createRecordingAnnouncer,
  createScriptedNavigation,
  createTestPorts,
  type ExitAttempt,
  type FakeDoc,
  type MemoryStorage,
  type RecordedAnnouncement,
  type RecordingAnnouncer,
  type ScriptedNavigation,
  type SpyFocusTarget,
  type TestPortOptions,
  type TestPorts,
} from "./testPorts.js";
