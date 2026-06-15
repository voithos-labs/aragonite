# Feature: Block render scoping

A keystroke re-renders only the blocks whose rendered DOM can actually
change — never the whole document. The block render path subscribes to the
document-level LRD resolver, so a careless reassignment of that resolver on
every edit invalidates every mounted block. This guards the render layer,
distinct from `inline-dirty-set` (which guards the inline-parse sweep).

## Happy paths

- typing a plain character scopes the render: with perf instruments armed,
  one keystroke in a document of dozens of reference-bearing blocks records a
  bounded block-render count (the edited block plus a small constant), not one
  render per mounted block — even though the edit fires the debounced inline
  flush that rebuilds the LRD resolver

## Edge cases

- a genuine LRD change scopes the render to reference-bearing blocks: editing a
  link-reference definition's URL re-renders the blocks that resolve through it
  plus the edited definition, but leaves bracketless prose blocks untouched —
  the render count stays bounded and does not scale with the bracketless-block
  count, while the references' rendered targets still update
