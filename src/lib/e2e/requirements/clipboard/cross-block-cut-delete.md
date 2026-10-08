# Feature: cross-block clipboard cut

## Edge cases

- Cut then undo restores the original document.
- Cut from a block's first character into the next block keeps the blank line above the survivor,
  so reloading the cut source still shows two blocks.

## User interactions

- Select across two paragraphs via Shift+ArrowDown, Ctrl+X: removes range, cursor at merge point.

## Pinned below the browser

These press keys over a cross-block range without a page:

- Backspace and Delete delete the range and leave cross-block mode
  (`test/selection/cross-block/keydown-destructive-gate.test.ts`).
- A typed character lands in the merged block, and the delete and the character share one undo
  entry (`test/selection/cross-block/cross-block-typed-char.test.ts`).
- Backspace, a cut and a typed character each leave the expected bytes and one undo entry holding
  the document as it stood (`test/selection/cross-block/range-replace.test.ts`).

## Miss-analysis

- The dropped separator (#60) shipped because every cross-block delete fixture selected from
  mid-block, and from the document's first block, whose leading blank lines are empty either
  way; the byte assertions also never reloaded their result, which is the only place the loss
  shows.
