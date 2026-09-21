# Feature: Handler-owned image ops, image gestures over bytes an inline handler owns (note-taking simulation)

A loaded-ops session on the plugins route where an inline syntax handler owns the image's
bytes: `?seed=wiki-embed` installs a `![[…]]` handler that creates built-in `image` nodes,
so every existing image gesture runs against bytes the editor must not re-serialize as
GFM. `resizeImage` already drove real Shift+Arrow key presses, but only ever over
`![alt](url)` that the built-in scanner created, so a plugin borrowing a built-in kind was
never watched by the simulation's reference checks.

What those checks add over the wiki-embed e2e battery: the live-CST round-trip and the
comparison of the live tree against a reparse of its own serialization both re-run after
every move, so a resize that wrote plausible-looking bytes which no longer reparse to the
same node fails here rather than at the next edit. The embed's bytes are literal in the raw
and round-trip cleanly, so the reparse comparison runs at every checkpoint.

## Happy paths

- two grow key presses run the handler's own resize hook: the source holds the widened
  embed (`|400` → `|440`) in the embed's own syntax, and `](` appears nowhere in the
  document. That GFM link syntax is what a built-in resize path would have written, and
  catching it is why this session exists
- two shrink key presses run the same path in the other direction and return the document
  to its loaded bytes exactly
- an edit in a neighbouring block leaves the owned bytes untouched: the source is
  byte-identical to the loaded document afterwards

## Edge cases

- the node is a built-in `image` kind whose bytes only the plugin's handler can serialize,
  so the round-trip check is what tells a good resize from a bad one: a resize that wrote
  GFM bytes would still render an image and still pass a count check
- gestures are separated by real pauses so each commit lands as its own undo batch rather
  than coalescing into the previous one

## User interactions

- the resize is real Shift+Arrow keyboard input on the selected image, not a programmatic
  metadata write
- the neighbouring edit is a real late correction typed into block 0

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel
- the live serializer round-trips the current CST at every checkpoint, and a reparse of
  that serialization matches the live tree at every checkpoint
- the nested-state audit finds no `BlockListState` out of sync after any resize or
  neighbour edit
