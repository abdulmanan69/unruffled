## What this changes

<!-- One or two sentences. What behaviour is different after this merges. -->

## Why

<!--
Name the specific defect this prevents or the capability it adds. If it fixes a bug, what did
the user experience before?
-->

Closes #

## Checklist

- [ ] `pnpm verify` passes locally
- [ ] A changeset is included, or this change does not affect a published package
- [ ] Comments explain _why_, not what

If this adds or changes an interactive affordance:

- [ ] There is a keyboard path, and a test that exercises it
- [ ] ARIA state is asserted by attribute, not checked by eye
- [ ] An outcome change announces, and a test asserts **exactly one** announcement reached the
      live region
- [ ] Nothing the user might be focused on becomes `disabled`

If this touches timing:

- [ ] Every timing assertion is driven by the fake clock from `@unruffled/testing`
- [ ] No test sleeps on a real timer

If this adds bytes:

- [ ] The size budget in the package's `package.json` still passes, or has been raised
      deliberately with the measured figure in the commit message
