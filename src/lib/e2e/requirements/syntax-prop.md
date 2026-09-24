# Feature: the `syntax` prop switches a GFM syntax off in one editor

A host can take indented code and setext headings out of one editor's grammar with
`syntax={{ indentedCode: false, setextHeading: false }}`. Only the reading changes: a leading tab
is whitespace in a paragraph, and `---` under text is a divider, which is GFM's own reading once
setext headings are out. The bytes never change, so a file saves exactly as it loaded.

`/test/syntax` mounts two live-mode editors over one seed, `Loaded`, a tab-indented `code` line,
and `Plan` over `---`. The first switches both syntaxes off, the second keeps GFM as shipped. Each
pane exposes its source and where its tree first differs from a reload in its own grammar.

Miss-analysis: the grammar view reached only the top-level opener dispatch, and every parse test
used the global grammar, so nothing checked what a filtered grammar reads inside a list item, a
quote, the first parse of a file, or the join check after a keystroke.

## Happy paths

- a loaded file reads as prose in one editor and as code and a heading in the other: the first
  pane holds paragraph, paragraph, paragraph, divider; the second paragraph, indented code, setext
  heading; both sources equal the seed, and both trees reload as themselves.
- Tab then `notes` on a new line is a paragraph in the first pane and indented code in the
  second, with the same bytes in both, and both trees reload as themselves.

## Edge cases

- typing at the end of the loaded `Plan` in the first pane leaves `Plans` a paragraph with the
  divider under it: the join check after the keystroke reads the editor's grammar, so it never
  folds the two into a heading.
- `Plan` over `---` pasted on a new line is a paragraph and a divider in the first pane, which
  land as two blocks with a blank line between them, and a setext heading in the second; both
  trees reload as themselves.
- Enter before the tab of the loaded `code` line in the first pane leaves an empty paragraph
  above a paragraph, no indented code, and a tree that reloads as itself. Miss-analysis: the split
  reread both halves in the global grammar, and no spec pressed Enter in the switched-off pane.
- Delete on the empty line that Enter left above the loaded `code` line joins the two back into
  the seed in the first pane, a paragraph with no indented code, and a tree that reloads as
  itself (regression #429). Miss-analysis: the split was pinned in the switched-off pane, and no
  spec joined two lines there, so the merge's reparse in the global grammar went unseen.

## User interactions

- every edit is a real gesture: a click on the text, End, Enter, Tab, typed characters, and
  Ctrl/Cmd+V over a seeded clipboard.
