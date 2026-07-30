# Feature: Claimed-image ops — image gestures over rung-claimed bytes (note-taking simulation)

A loaded-ops session on the plugins route where an inline rung has CLAIMED the image's
bytes: `?seed=wiki-embed` installs a `![[…]]` rung that mints built-in `image` nodes, so
every existing image gesture runs against bytes the editor is forbidden to re-serialize
as GFM. `resizeImage` already drove real Shift+Arrow presses, but only ever over
`![alt](url)` the built-in scanner minted, so the whole borrow-a-built-in-kind class ran
outside the oracle stack — the scar culture.md names, a plugin surface going a minor
version unobserved by the simulation. The gap was a seed, not a verb.

What the oracle stack adds over the wiki-embed e2e battery: the live-CST round-trip and
live-vs-reparse convergence re-run after every move, so a resize that wrote
plausible-looking bytes which no longer reparse to the same claimed node fails here
rather than at the next edit. The embed's bytes are literal in the raw and round-trip
cleanly, so convergence runs unconditionally.

## Happy paths

- two grow presses drive the rung's own resize hook: the source carries the widened
  embed (`|400` → `|440`) in the embed grammar, and the document holds no `](`
  anywhere — the GFM destination syntax that a built-in resize path would have written
  is the corruption this session exists to catch
- two shrink presses run the same path in the other direction and return the document to
  its loaded bytes exactly
- an edit in a NEIGHBOURING block leaves the claimed bytes untouched: the source is
  byte-identical to the loaded document afterwards

## Edge cases

- the claimed node is a built-in `image` kind whose bytes only the rung can serialize, so
  the round-trip oracle is the discriminator: a resize that wrote GFM bytes would still
  render an image and still pass a count check
- gestures are separated by real pauses so each commit lands as its own undo batch rather
  than coalescing into the previous one

## User interactions

- the resize is real Shift+Arrow keyboard input on the selected image, not a programmatic
  metadata write
- the neighbouring edit is a real late correction typed into block 0

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel
- the live serializer round-trips the current CST at every oracle checkpoint, and a
  reparse of that serialization converges back to the live tree at every checkpoint
- the nested-state audit finds no BlockListState desync after any resize or neighbour edit
