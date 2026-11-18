# Feature: a plain key beside syntax

Backspace at a block's start or Delete at its end that can't join the block beside it moves the
caret across instead. It lands where a removal's caret would on that side, never on a name, a
fence line, a `$$` line or a heading's `#`: under a `:::` row that is all name and beside a table
of contents it holds the gap. Enter at a heading's text start moves the heading down and the caret
stays at that text. A caret the user puts on syntax still types there. Fixture: the
`/test/plugins` harness, both modes; the key, then `q`, then a click away (a `$$` body commits its
source there).

## Happy paths

- Backspace at the start of a callout's body under an untitled row: the gap under the row, and `q`
  opens a paragraph inside the callout
- Delete at a paragraph's end before an untitled callout: `q` starts the callout's text
- Delete at a paragraph's end before a heading: `q` lands past `# ` in source mode too
- Delete before a titled callout: `q` starts the title
- Delete before a table of contents, and Backspace after one: the gap beside it, `q` in a
  paragraph of its own
- Delete before a `$$` block: `q` starts its body; Backspace after one: `q` ends its body, a
  one-line `$$m$$`'s formula too
- Enter at a heading's text start: the heading moves down and `q` starts its text
- Enter at a title row's end: `q` starts the body's first text, past a heading's `# ` and on into
  a tip under an untitled row; above a table of contents, the gap under the row

## Edge cases

- The gap under the row is drawn, adds no undo entry, and ArrowDown leaves it for the text below

## Miss-analysis

- The plain keys landed through each neighbour's own entry caret, which sits before a heading's
  `#` in source mode and at a name's end, and every row typed a letter only after a range.
- Enter at a title row's end was only typed above a paragraph, so no row met a body whose first
  block an entry caret puts on syntax.
