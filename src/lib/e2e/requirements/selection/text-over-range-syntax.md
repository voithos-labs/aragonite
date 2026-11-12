# Feature: Text over a range lands where the range was

When a range takes the block it started in (a table held whole, say), the caret the removal leaves
sits in the block beside the range. If that caret is on the block's syntax rather than its text
(a fence, a heading's `#`, a rule, an HTML tag), text typed, pasted or composed over the range
goes in a new paragraph where the range was: before a block below it, after a block above it.
Where the caret is on text, the text joins the block there. Every row runs in source and live mode.

## Happy paths

- Click the cell of a one-row table and press Shift+Down, so the range takes the table and stops
  at the first byte of the block below. Type `x`, paste `x`, or compose `か` and commit `漢`. The
  text stands in a paragraph of its own where the table was, the block below keeps its bytes and
  its kind, and the caret sits right after the text. The block below is each of:
  - a heading, `# Head`
  - a fenced code block, which keeps its closing fence
  - an HTML block
  - an indented code block
  - a rule
  - a math block, with latex installed
  - a diagram, with mermaid installed
  - a list item opening with a fenced code block: the paragraph goes before the list
- A quote holding a one-row table and a heading under it. The same click and Shift+Down, and each
  gesture puts its text in a paragraph inside the quote, where the table was.
- A fenced code block or a rule, then two one-row tables. Click the first table's cell and press
  Shift+Down, so the range takes both tables and the caret falls back on the end of the block
  above. Each gesture puts its text in a paragraph after that block, never after its closing fence
  on the same line.

## Edge cases

- The same range down into a paragraph or a setext heading: the caret is on the block's text, so
  the text joins it there (`xplain`, `xHead` over `===`).
- Into a quote or a list, the range ends past the quote's `> ` or the item's `- `, so it takes
  that marker, and the text joins what follows at the table's level, as a range from a paragraph
  takes the containers its end enters (`xq`, `xli`; a composition lands `漢li`).
  Miss-analysis: the row was skipped while the list marker was editable text inside the
  paragraph, where the composed text landed and the read-back dropped it; the marker's own cell
  fixed it, and the skipped row hid that it passed.
- An abandoned composition (compose `か`, commit nothing) over the table and the heading below
  leaves the removal and the empty paragraph it opened.

- A definition `[a]: /u` whose title starts on the next line (`    'code`), then `# h`, `text`,
  `end'`: click at the heading's first byte and Shift+click in the middle of `text`, at top level
  and inside a quote, then type `x` or paste `x`. The removal joins what is left of `text` to the
  title, so no boundary stands where the range began, and the text joins the title there (`xxt`),
  as Ctrl+X and then `x` leave it. Source mode only: a live click lands behind the hidden `# `.
  Miss-analysis: every row's removal left the blocks above the range where they were, so the
  start block's path from before the removal still named its place, and the text landed after the
  document's last block or was dropped where the commit had joined the lines.

## User interactions

- One Ctrl+Z after each gesture puts the table and the block back and the range back as drawn:
  the removal, the opened paragraph and the text are one undo entry.

- Miss-analysis: every typed-over-range row kept a block with text at the caret, or a rule whose
  typed key took a route of its own, so no row typed, pasted or composed at a caret sitting in
  front of a block's opener or past its closing fence.
