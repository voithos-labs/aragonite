# Feature: joining into a setext heading

A setext heading's underline is part of its structure, drawn as a marker after the title. Where
markers hide (live) the title's end is the block's end for the caret; where the underline paints
(source, and preview-inline on the focused block) the block ends past it. A join into the heading
puts the joined text on the title line and leaves the underline under it, the way Delete joins two
paragraphs, and the heading stays a heading. Driven on `/test/editor` with `?presentationMode=` and real keys; the source,
the block kind and the caret are what each scenario checks.

Miss-analysis: the one pin on this join encoded Delete's refusal in live mode as the contract, so
no test asked what the join should write; Backspace from the block below and a range delete out of
the title were never driven against a setext heading, and ArrowRight at the title end was only
driven in live mode, the one mode whose caret bound read the screen. The range delete was then only
driven into blocks with nothing past their text, so the underline of a heading it ended in was
never asked about. The edge case below drives one such range in the browser, and
`src/lib/test/selection/range-delete-setext.test.ts` drives it in source and live mode from
another title, from a paragraph and inside a quote.

Miss-analysis (Delete at the title's end in live mode, from `presentation-live-demote.md`): the pin
on this keypress encoded its refusal as the contract, so the join it declined was never specified.

## Happy paths

- Delete at the block's end, in source, live and preview-inline: the next block's text joins the title line and the underline stays under it (`Setext\n======\n\nnext\n` becomes `Setextnext\n======\n`); the caret sits between the two texts; the block is still a setext heading
- one undo puts both blocks back
- Backspace at the start of the block below makes the same join, in the same three modes

## Edge cases

- a range deleted from inside the title into the block below keeps the underline under the joined text, and the heading stays a heading
- a range that ends inside a setext title takes that title's underline with it (`Setext\n======\n\nOther\n---\n` becomes `Sether\n======\n`), and one undo puts both blocks back
- ArrowRight at the block's end moves the caret to the start of the next block in every mode
- before a block that is not prose (a list, a table, a fenced code block), Delete at the title end does what it does at a paragraph's end there: the caret moves into that block and no byte changes

## User interactions

- real clicks, Home and End, arrow steps and a shift-click; the caret and the selection come from the browser
- assertions read the source, the block kind and the selection through the bridge

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
