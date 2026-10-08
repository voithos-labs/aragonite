# Feature: cross-block clipboard cut

## Edge cases

- Cut then undo restores the original document.
- Cut from a block's first character into the next block keeps the blank line above the survivor,
  so reloading the cut source still shows two blocks.

## User interactions

- Select across two paragraphs via Shift+ArrowDown, Ctrl+X: removes range, cursor at merge point.

## Pinned below the browser

Backspace, Delete and typing over a cross-block range, and Ctrl+X removing it, ran as rows here and
moved to `test/selection/cross-block/keydown-destructive-gate.test.ts`,
`cross-block-typed-char.test.ts` and `range-replace.test.ts`, which press the same keys over the
same ranges without a page.

## Miss-analysis

- The dropped separator (#60) shipped because every cross-block delete fixture selected from
  mid-block, and from the document's first block, whose leading blank lines are empty either
  way; the byte assertions also never reloaded their result, which is the only place the loss
  shows.
