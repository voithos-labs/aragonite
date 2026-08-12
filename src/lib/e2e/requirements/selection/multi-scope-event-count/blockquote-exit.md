# Feature: One Edit Event per Op — Blockquote splitBlock Exit

## Migrated sites covered

- `blockquote splitBlock exit` (Enter on empty trailing paragraph inside blockquote) — one edit event, and the empty child leaves the quote as a minted blank beside it

## Fixture constraints

- The document needs a block below the quote: it pins that the exit is one replaceBlock over the quote's own slot, never a delete plus a landing in the block below.
