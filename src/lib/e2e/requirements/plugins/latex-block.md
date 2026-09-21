# Feature: Block `$$…$$` display math, render-primary, source-on-focus

A `mathBlock` leaf renders its KaTeX display by default and shows the raw `$$…$$` source in a
contenteditable on focus or click, re-rendering on blur. That source is painted like a code
block's, with fence lines the marker-hiding modes collapse and LaTeX highlight tokens, and its
`textContent` is the bytes. In the default `split` layout the render stays up beside it as a
live preview, `stacked` puts the preview below, and `source` shows none. The block never merges
with a neighbor and can take focus, and while its source is shown it behaves like a code block
for caret and selection. Driven through real mouse and keyboard only, because the reactive swap
between render and source, and the caret surviving it, are exactly what the unit layer cannot
prove.

## Happy paths

- A block with no body line (`$$$$`, or `$$` straight over `$$`) shows an opener, one empty body
  line and a closer, so the caret has a line to sit on. Backspace on that empty line deletes the
  block and puts the caret in the block above, in live and source mode alike. Backspace at the
  start of a body that has content deletes nothing

- Renders the KaTeX display by default: a block showing its render has a `.katex`, no source
  contenteditable, and the tree still holds `$$x^2$$`
- A click shows the editable source without touching the tree: the source holds focus with the
  raw `$$x^2$$` as its text, the render stays up as the split layout's preview, and the document
  has not changed, since only what is shown changed
- Editing the source and blurring re-renders: the block goes back to a KaTeX display and the
  edit is kept in the tree, round-trip stable

## User interactions

- Arrowing into the block from a neighbor shows the source; arrowing back out of either edge
  hides it again and puts focus on the next block
- ArrowUp and ArrowDown cross in and out of the block by sticky column, like a code block
- A paste into the shown source is taken as plain text: HTML on the clipboard is dropped rather
  than inserted as live markup, and the edit stays out of the tree until the blur commits it
  (with the render showing, copying falls back to the browser's own, since there is no source to
  slice)

## Edge cases (spec's named highest-risk)

- **A1** the caret survives the swap: once the source is shown it sits at the offset that was
  asked for, the leading edge when it arrived by arrow, and the point clicked when by click,
  which `latex-block-click-caret.md` owns, rather than being pushed to a block edge by the
  reactive re-render; a character then typed inside the formula lands at the caret
- **A7** a multiline `aligned` fence renders, and the source shown for it, painted as fence
  lines and highlight spans, has a `textContent` equal to the raw text byte for byte, with its
  internal `\n`s intact and nothing added, so the offset traversal is exact
- A selection extended across the boundary of the shown source becomes a cross-block selection,
  and the source stays shown while the selection is live, since a widget the caret cannot enter
  could not be selected through
- Undo after showing the source, editing it and committing restores the source as it was before
  the edit, in one step, because the edit held outside the tree committed as a single undo entry
- Undo inside the shown source walks that source's own edits back first, one keystroke per
  press, and only then reaches the document's history, whose restore fills the source again; the
  blur after that commits nothing stale
- Redo after that restore is the document's: the draft's own redo entries were taken against
  bytes the document has replaced, so they are gone rather than painted back
