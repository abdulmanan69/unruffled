# Security policy

## Reporting a vulnerability

Report privately through GitHub Security Advisories:

**https://github.com/abdulmanan69/unruffled/security/advisories/new**

Please do not open a public issue for a security problem.

Include what the issue is, how to reproduce it, which package and version, and what an
attacker gains. A proof of concept is ideal but not required.

You will get an acknowledgement within 72 hours and an assessment within seven days. If a fix
is needed, you will be credited in the advisory and the release notes unless you ask not to be.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

While the project is pre-1.0, fixes land on the latest minor only.

## The shape of the attack surface

Worth stating plainly, because it is unusually small and that changes what is worth looking
for.

**The library has no runtime dependencies.** `@unruffled/core` and `@unruffled/react` each
declare zero. There is no transitive tree to audit and no supply-chain surface beyond npm
itself and React.

**It renders no markup and emits no HTML.** There is no `dangerouslySetInnerHTML`, no
`innerHTML`, no template interpolation into a DOM sink anywhere in either package. The one
place text reaches the DOM is the live region, which is written with `textContent`, never
`innerHTML`. Text written there is read aloud, not parsed.

**It never fetches anything.** Requests are functions you supply, run through the transport
port. The library adds no endpoint, no header and no credential.

**It evaluates nothing.** No `eval`, no `new Function`, no dynamic import of a computed path.

### Where to look

If you are auditing this, the areas with genuine risk are:

1. **`normalizeError`** — it parses untrusted response bodies: RFC 9457, JSON:API pointers,
   `field_errors` maps, flat path lists. It must never throw regardless of input, and the
   strings it produces must stay plain text. Note that `detail` carries server text verbatim
   for a technical disclosure, which is why it is kept separate from the user-facing
   `message`. **Neither is safe to pass to an HTML sink**, and nothing in the library does.

2. **`navigation.beacon`** — this is the only place the library can cause a network request,
   and only with a URL and body you passed it. It is used to flush a deferred write on unload.

3. **The live-region queue** — a message that could be injected by a remote party is read
   aloud to an assistive-technology user. Announcement strings should be treated as untrusted
   if they originate from a response body.

4. **`storage`** — the DOM implementation wraps every access in try/catch and stores only what
   a consumer puts there. The library itself writes nothing to it in 0.1.0.

### Diagnostics and production builds

The diagnostics bus captures a stack trace to attribute a call site, and the rule table
contains file paths from the developer's machine in its output. All of it is removed from
production builds: the rule table lives on the `@unruffled/core/diagnostics` subpath that no
production code path imports, and every report site is behind a build-time flag.

If you find diagnostics output, a captured stack, or a source path in a production bundle of
this library, that is a bug worth reporting.
