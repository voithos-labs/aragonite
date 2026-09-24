# Feature: joining into a setext heading

A setext heading's underline is part of its structure and no presentation mode draws it, so the
title's end is the block's end for the caret. A join into the heading puts the joined text on the
title line and leaves the underline under it, the way Delete joins two paragraphs, and the heading
stays a heading. Driven on `/test/editor` with `?presentationMode=` and real keys; the source,
the block kind and the caret are what each scenario checks.

Miss-analysis: the one pin on this join encoded Delete's refusal in live mode as the contract, so
no test asked what the join should write; Backspace from the block below and a range delete out of
the title were never driven against a setext heading, and ArrowRight at the title end was only
driven in live mode, the one mode whose caret bound read the screen.

## Happy paths

- Delete at the title end, in source, live and preview-inline: the next block's text joins the title line and the underline stays under it (`Setext\n======\n\nnext\n` becomes `Setextnext\n======\n`); the caret sits between the two texts; the block is still a setext heading
- one undo puts both blocks back
- Backspace at the start of the block below makes the same join, in the same three modes

## Edge cases

- a range deleted from inside the title into the block below keeps the underline under the joined text, and the heading stays a heading
- ArrowRight at the title end moves the caret to the start of the next block in every mode: the underline is not a place the caret can reach
- before a block that is not prose (a list, a table, a fenced code block), Delete at the title end does what it does at a paragraph's end there: the caret moves into that block and no byte changes

## User interactions

- real clicks, Home and End, arrow steps and a shift-click; the caret and the selection come from the browser
- assertions read the source, the block kind and the selection through the bridge

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
