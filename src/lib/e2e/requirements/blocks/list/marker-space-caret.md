# Feature: a space at a list item's content start

A space typed right after an item's marker widens the marker by a column, and the item's lines are
read again under the wider marker: a paragraph indented to the old column leaves the item. The
typed space belongs to the marker, so the caret stays in front of the text it was in front of.

## Happy paths

- In `- ab` (a blank line, then `  b` under it), caret before `a`, Space, then `X`: the source is
  `-  Xab`, the blank line, `  b`, in source mode and in live mode
- The same item inside a quote, `> - ab`, `>`, `>   b`: Space, then `X` gives `> -  Xab`, `>`,
  `>   b`, in both modes

## Miss-analysis

- The keystroke's caret after a re-read was placed by its offset in the leaf as written, which the
  re-read had shortened by the space the marker took. No row typed a space at an item's content
  start with a paragraph below it, so the fold that re-read the item went unseen.
