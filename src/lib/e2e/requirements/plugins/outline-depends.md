# Feature: a table of contents that reads the document through `depends`

An `[[outline]]` box (`lineBlock`, `edit: 'box'`, `routes/test/plugins/outline`) declares the guide's
`headingsIn` as its block type's `depends` and lists one row per heading. A click on a row reads
`ctx.editor.doc.blocks[i]` for the answer the row came from and selects that block's heading. The
seed holds `# Alpha`, a paragraph, `## Beta`, a paragraph, two hundred filler paragraphs, then
`## Omega`, with the outline first.

Miss-analysis: no real browser had run `depends`, and the unit rows held the answers' order, never
their index, so an Enter above a heading left the rows pointing a block off.

## Happy paths

- Loading the page: the outline lists Alpha, Beta and Omega the moment it enters the page, and
  `draw` itself drew those rows, with no `update` after it.
- A letter typed at the end of `# Alpha`: its row reads AlphaX.

## Edge cases

- Enter inside the paragraph above `## Beta`, then a click on Beta's row: the caret lands in
  `## Beta`, now one block further down.
- The editor scrolled to its end, so the outline leaves the window, then back to its top: the
  outline is drawn again with the same rows, and no block's `depends` is asked.

## User interactions

- A letter typed in a paragraph: one block is asked and the outline runs no `update`.
