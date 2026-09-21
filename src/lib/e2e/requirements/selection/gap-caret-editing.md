# Feature: minting a paragraph at the gap caret

A boundary the editable areas cannot reach, a table directly above a code fence, is
where the gap caret rests. This file covers what the caret does there: creating a
paragraph, and the path undo takes back to the boundary. Arrival and the exits are in
`gap-caret-arrival.md`; the gap caret itself is in `gap-caret-surface.md`.

The bytes are what every scenario checks. A separator bug at a boundary no editable area
reaches would be invisible to every other spec.

## Happy paths

- Typing a printable character at the gap between a table and a fence: a paragraph carrying
  that character appears between them, and the caret lands after it, so the next character
  extends the same paragraph. The source reads
  `…| c | d |` / blank / `xy` / blank / ` ``` `.
- Enter at the same gap: an empty paragraph appears with the caret in it. Typing then fills
  it, and the source separates it from both neighbours by exactly one blank line.
- A paragraph created at the gap that ends a container's child list (a blockquote whose last
  child is a fence) lands inside the container: the source gains a `>` line and a `> x` line,
  and the quote's own bytes are rebuilt around them.
- One undo removes the created paragraph and puts the caret back in the gap it came from:
  the boundary, not a block beside it.
- Redo brings the paragraph back with the caret in it, so typing extends it.
- A second undo carries on to the edit below it: an entry that records a gap is an ordinary
  stack entry.
- Mod+Z with the caret in a gap resolves as it does on any block, through the editor's
  global chord table.

## Edge cases

- An undo whose entry names a boundary currently outside the render window mounts the
  boundary's neighbour first, so the gap has a mounted list to paint in.
- The new paragraph's line endings are copied from a real neighbour, so a CRLF document
  stays CRLF (pinned in the unit test `test/editor-actions/gap-mint.test.ts`, which owns
  the byte matrix).

## User interactions

- Every arrival is a keystroke or click; every insert is real typing or a real Enter; every
  undo is Mod+Z. No programmatic selection or commit calls.

## Known v1 narrowings

- **Paste is refused.** Mod+V at the gap changes nothing and keeps the caret there. The
  clipboard's contents carry block structure the boundary has no placement rule for yet, so
  v1 declines rather than guesses. Every input type but `insertText` is refused the same way.
- **IME is a unit-level contract only.** Between `compositionstart` and `compositionend` the
  browser owns the proxy element, which is the editor's standing rule for composition; the
  composed text creates the paragraph once on `compositionend` and the proxy is emptied.
  Playwright drives no real IME, so the harness cannot run a composition against a gap
  proxy: those branches are pinned by construction and by that shared rule, not by a
  scenario here.
- The insert always produces a **paragraph**. Choosing another kind at the boundary is not
  offered in v1.

## Miss analysis

Creating a paragraph here is new behavior, so no test could have caught its absence. The
undo half belongs to the same class as #88 (see `gap-caret-surface.md`), _editor-owned
state that outlives the operation which created it_; what holds it is that the undo entry
records the gap when it is pushed and the restore path puts it back, both pinned at unit
level as well as end to end.
