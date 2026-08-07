# Feature: minting a paragraph at the gap caret

A boundary the editing surfaces cannot reach — a table directly above a code fence — is
where the gap caret parks. This file covers what the caret DOES there: minting a paragraph,
and the undo road back to the boundary. Arrival and the exits are
`gap-caret-arrival.md`; the surface itself is `gap-caret-surface.md`.

Bytes are the oracle throughout. A separator bug at a boundary no surface reaches would be
invisible to every other spec.

## Happy paths

- Typing a printable character at the gap between a table and a fence: a paragraph carrying
  that character appears between them, and the caret lands after it, so the next character
  extends the same paragraph. The source reads
  `…| c | d |` / blank / `xy` / blank / ` ``` `.
- Enter at the same gap: an empty paragraph appears with the caret in it. Typing then fills
  it, and the source separates it from both neighbours by exactly one blank line.
- A mint at a container's scope-end gap (a blockquote whose last child is a fence) lands
  INSIDE the container: the source gains a `>` line and a `> x` line, and the quote's own
  bytes are rebuilt around them.
- One undo after a mint removes the paragraph and puts the caret back in the gap it was
  minted from — the boundary, not a block beside it.
- Redo brings the paragraph back with the caret in it, so typing extends it.
- A second undo carries on to the edit below the mint: a gap-carrying entry is an ordinary
  stack entry.
- Mod+Z with the caret parked in a gap resolves as it does on any block surface, through the
  editor's global chord table.

## Edge cases

- An undo whose entry names a boundary currently outside the render window reveals the
  boundary's neighbour first, so the gap has a mounted list to paint in.
- The minted paragraph's line endings come off a real neighbour, so a CRLF document stays
  CRLF (unit-pinned in `test/editor-actions/gap-mint.test.ts`, which owns the byte matrix).

## User interactions

- Every arrival is a keystroke or click; every mint is real typing or a real Enter; every
  undo is Mod+Z. No programmatic selection or commit calls.

## Known v1 narrowings

- **Paste is refused.** Mod+V at the gap changes nothing and keeps the caret there. A
  clipboard payload carries block structure the boundary has no placement rule for yet, so
  v1 declines rather than guesses. Every input type but `insertText` is refused the same way.
- **IME is a unit-level contract only.** Between `compositionstart` and `compositionend` the
  browser owns the proxy (the editor's standing IME stance); the composed text mints once on
  `compositionend` and the proxy is emptied. Playwright drives no real IME, so the harness
  cannot exercise a composition against a gap proxy — the arms are pinned by construction and
  by the shared stance, not by a scenario here.
- The mint always produces a **paragraph**. Choosing another kind at the boundary is not a v1
  affordance.

## Miss analysis

Minting is new behavior, so no test could have caught its absence. The undo half's class —
_a live editor-owned state that outlives the operation which created it_ — is the same class
as #88 (see `gap-caret-surface.md`); the guard here is that the entry records the gap at
push and the restore road puts it back, both pinned at unit level as well as end to end.
