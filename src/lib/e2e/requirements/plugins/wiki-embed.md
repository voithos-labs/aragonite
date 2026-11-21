# Feature: an inline construct that reads as a built-in image keeps its own bytes

The `wiki-embed` dogfood reads `![[path|width]]` through an `inline()` construct on the `![[`
prefix with `as: 'image'`, which makes a built-in `image` node, so the embed is an image as far as the whole editor is
concerned. Its `write` is what lets an edit come back as `![[…]]` rather than as
GFM. Seed `wiki-embed`: block 0 `Before`, block 1 the embed at width 400, block 2 `After`.

## Happy paths

- Seed render: block 1 shows one image widget, and the source still reads
  `![[/test-fixtures/sample.png|400]]`.

## User interactions

- Keyboard resize: selecting the widget and pressing Shift+ArrowRight commits
  `![[/test-fixtures/sample.png|420]]`, so the width changes and the embed syntax survives, with
  no GFM `![alt](url)` anywhere in the source.
- Pointer resize: dragging the right handle inward commits a smaller width, still written as
  `![[…|N]]`.
- Undo: one undo after a resize restores the original embed bytes exactly.

## Error cases

- The overlapping case is a unit concern (`inline/inline-reads.test.ts`): the editor declines the
  claim on `![[a]](u)`, which is a built-in image it still owns. Both resize gestures assert that
  no console errors were captured.
