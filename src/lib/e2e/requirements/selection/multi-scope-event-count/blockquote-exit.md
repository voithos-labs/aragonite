# Feature: One Edit Event per Op — Blockquote splitBlock Exit

## Migrated sites covered

- `blockquote splitBlock exit` (Enter on empty trailing paragraph inside blockquote) — one edit event, and the empty child leaves the quote rather than the document

## Fixture constraints

- The document needs a block below the quote. With nothing to leave to, the exit appends one, and that append is a second op — a second event for a second op, not a duplicate for this one.
