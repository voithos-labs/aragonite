# Feature: an inline rung that mints a built-in image keeps its own bytes

The `wiki-embed` dogfood claims `![[path|width]]` through a `![[` prefix rung and
mints a built-in `image` node, so the embed is an image to the whole editor. Its
`rewriteImage` hook is what lets an edit come back as `![[…]]` instead of GFM.
Seed `wiki-embed`: block 0 `Before`, block 1 the embed at width 400, block 2 `After`.

## Happy paths

- Seed render: block 1 shows one image widget; the source still reads
  `![[/test-fixtures/sample.png|400]]`.

## User interactions

- Keyboard resize: selecting the widget and pressing Shift+ArrowRight commits
  `![[/test-fixtures/sample.png|420]]` — the width changes and the embed syntax
  survives; no GFM `![alt](url)` appears anywhere in the source.
- Pointer resize: dragging the right handle inward commits a smaller width still
  written as `![[…|N]]`.
- Undo: one undo after a resize restores the original embed bytes exactly.

## Error cases

- The declined overlap is a unit concern (`inline-ladder-bang.test.ts`): the rung
  declines `![[a]](u)`, which is a built-in image the editor still owns. The e2e
  asserts no console errors are captured across every gesture.
