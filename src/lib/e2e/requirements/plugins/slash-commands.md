# Feature: slash commands

The bundled slash-commands plugin, listed in the `inline-menu` seed of the plugins harness. Typing
`/` at the start of a line or after a space opens a list of the blocks the insert catalogue offers,
three heading levels and any rows the host adds. The query narrows it; a pick removes the `/query`
bytes and inserts the block. `Mod+/` types the `/` for an author who cannot reach a right-click,
and `runCommand('slashCommands.open', query)` opens the list already narrowed.

## Picks

- `/code js` on an empty line: the row reads "Code block" with `js` beside it, and Enter leaves a
  fence whose info string is `js`, with the caret inside it, so the next keystroke lands in its body.
- `/table 3x4` on an empty line: a table of three columns and four rows (a header and three empty
  rows) replaces the line.
- `/h2` at the end of a text line turns that line into a level-2 heading, its text intact and the
  `/h2` gone.
- `/h` then Enter on an empty line makes a level-1 heading: the first row is Heading 1, never the
  divider. Miss-analysis: the pick cases each typed a full name, so none met the order a short
  query lists rows in.
- `/quote` at the end of a text line keeps the line as it was and lands a quote in a new block
  directly below it, with the caret in the quote.

## Opening

- A slash inside a word opens nothing: `and/or` and `9/22` stay text.
- A row draws its menu glyph beside the label.
- `Mod+/` on an empty line types the `/` and opens the list there; typing on narrows it.
- `runCommand('slashCommands.open', 'table')` types `/table` and opens the list narrowed to the
  table row.

## A table cell

No inline menu opens in a table cell, whose line cannot take a block. Miss-analysis: no test typed
a trigger in a cell, so the rule held only for a selection covering whole cells.

- `/quote` typed in an empty cell stays text: the bytes land in the cell and no list shows.
- `Mod+/` with the caret in a cell declines: nothing is written and no list shows.
- A tag typed in a cell opens no tag list, though the document holds a matching tag.

## Leaving without a pick

- `/something`, then Escape, then typing ` more` leaves `/something more` in the line with the
  caret after it.
- Escape on a showing list closes it without moving the caret or touching the bytes, and typing
  on does not reopen it, even where the longer query would match a row.
- `/zzz` lists nothing, so Enter is the document's: it splits the line like plain text.

## Error cases

- zero `[invariant:…]` console fires across the battery (asserted through `capturedErrors`)
