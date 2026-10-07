# Feature: the `placeholder` prop, a hint in an empty block

A host passes `placeholder` to show faint text in an empty block until something is typed. A
string shows only in an empty, editable document; a function is asked about each mounted empty
block (its kind, path, whether the document is that one block, whether the caret is in it, and
whether it is editable) and answers with the text or null. The hint is painted by CSS from the
block's `data-placeholder` attribute and announced as `aria-placeholder`, so it never enters the
bytes, the undo stack or the caret. The prop reads live. The decision itself is unit-pinned in
`src/lib/test/components/placeholder.svelte.test.ts`; these rows cover what needs a browser.

## Happy paths

- An empty document with a string hint shows it; the first typed letter removes it, and deleting
  that letter brings it back.
- A function hint that answers only for the block holding the caret follows the caret as a click
  moves it from one empty block to another.
- A prop change while mounted repaints the same element: no block remounts.

## Edge cases

- Reading mode never shows the string form, and switching back to source mode shows it again.
- An empty heading in source mode paints its hint after the visible `# `, not under it.
- An IME composing into the empty block hides the hint and its `aria-placeholder`, since the
  composed text is in the element but not yet in the document.

## User interactions

- The caret paints at the same point with and without the hint, in source and live mode, for each
  way a block draws what comes before its text: a paragraph, a heading, a list item, a task item,
  a quote and a code block.
- A click on the painted hint puts the caret at the block's start; the bytes, the undo depth and
  the selection stay as they were through the click and through the prop changing.
