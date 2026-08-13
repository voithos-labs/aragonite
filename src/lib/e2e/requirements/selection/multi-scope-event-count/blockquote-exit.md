# Feature: One Edit Event per Op — Blockquote splitBlock Exit

## Migrated sites covered

- `blockquote splitBlock exit` (Enter on empty trailing paragraph inside blockquote) — one edit event, and the empty child leaves the quote as a minted blank beside it

## Fixture constraints

- The document needs a block below the quote: it pins that the exit is one replaceBlock over the quote's own slot, never a delete plus a landing in the block below.

## Shape

- After the exit the live blocks are the blocks a reload of the bytes mints: the minted blank IS the separating line of the block below it, so the bytes carry three lines between quote and follower, not four.

## Miss-analysis

- The event-count assertion carried a byte expectation as a bystander, and no arm compared those bytes to what a reload of them mints. The unit sibling (`test/blocks/blockquote/blockquote-exit-enter.test.ts`) had the same hole, so when the settle funnel corrected the shape, one twin was fixed and this one kept asserting the divergent bytes — the sibling-parity class, inside the change that closed it. Both twins now carry a convergence arm.
