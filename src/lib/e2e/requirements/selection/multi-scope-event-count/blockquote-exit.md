# Feature: One Edit Event per Op, Blockquote splitBlock Exit

## Migrated sites covered

- `blockquote splitBlock exit` (Enter on empty trailing paragraph inside blockquote): one edit event, and the empty child leaves the quote as a new blank paragraph beside it

## Fixture constraints

- The document needs a block below the quote: it pins that the exit is one `replaceBlock` over the quote's own position, never a delete plus a landing in the block below.

## Shape

- After the exit the live blocks are the blocks a reload of the bytes produces: the new blank paragraph is the separating line of the block below it, so the bytes carry three lines between quote and follower, not four.

## Miss-analysis

- The event-count assertion carried a byte expectation as a bystander, and nothing compared those bytes to what a reload of them produces. The unit counterpart (`test/blocks/blockquote/blockquote-exit-enter.test.ts`) had the same hole, so when the one call that recomputes the blank lines corrected the shape, one of the pair was fixed and this one kept asserting the diverging bytes: a sibling path never asserted as a class, inside the change that closed it. Both now compare against a reload.
