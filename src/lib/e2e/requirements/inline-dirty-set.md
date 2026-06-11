# Feature: Inline dirty-set scoping

The per-edit inline sweep refreshes only the edited top-level subtree on
intra-block edits; an LRD signature change widens it back to whole-doc so
cross-block references stay fresh.

## Happy paths

- typing scopes the sweep: with perf instruments armed, one keystroke in a
  30-paragraph document records an inline refresh of at most 2 prose nodes,
  not all 30
- LRD edit re-resolves other blocks: typing an LRD into one block turns an
  unresolved reference in another block into a resolved link — both in the
  rendered DOM and in that block's cached `inlineContent` (the signature
  change forces a whole-doc sweep)
