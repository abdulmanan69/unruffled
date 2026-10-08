# Changesets

This folder holds the pending release notes. Add one with:

```sh
pnpm changeset
```

Write the entry for someone reading the changelog in six months, not for the reviewer reading
the diff.

The three published packages are on a **fixed** version train: `@unruffled/core`,
`@unruffled/react` and `@unruffled/testing` always release together with the same number. They
are one library split for tree-shaking, not three products, and a consumer should never have to
reason about which combination of versions is compatible.

`@unruffled/docs` is ignored; it is never published.
