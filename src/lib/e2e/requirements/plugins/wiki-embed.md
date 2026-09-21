# Feature: an inline rung that mints a built-in image keeps its own bytes

The `wiki-embed` dogfood takes `![[path|width]]` through an inline handler on the `![[` prefix
and creates a built-in `image` node, so the embed is an image as far as the whole editor is
concerned. Its `rewriteImage` hook is what lets an edit come back as `![[…]]` rather than as
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

- The overlapping case it declines is a unit concern (`inline-ladder-claim.test.ts`): the
  handler declines `![[a]](u)`, which is a built-in image the editor still owns. Both resize
  gestures assert that no console errors were captured.
