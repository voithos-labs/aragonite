# Feature: live-mode pending marks (a collapsed-caret toggle with no bytes)

Source and the preview rungs paint the delimiter a `Mod+B` at a collapsed caret inserts, so
the user can see the empty `**|**` they made and the second press that removes it. Live paints
nothing, so the same pair is invisible garbage the moment the user walks away from it. In live
the chord therefore writes NO bytes: it pends a mark, and the FIRST insertion after it —
keystroke or IME commit — carries that mark into the bytes as one commit. The mark is resolved
against the caret's construct chain, so a kind the chain lacks wraps the insertion and a kind
it carries escapes it. Driven on `/test/editor` via `?presentationMode=live` with real chords,
real keystrokes, real clicks and a real CDP composition; the assertion is the SOURCE, plus the
rendered element where "renders bold" is the claim.

Miss-analysis (undo granularity): the suite pinned one-entry-per-commit only for STRUCTURAL
ops, which break the keystroke batch through the commit ceremony. A format toggle shares
`updateBlockContent` with typing, so it coalesced into the surrounding burst and nothing
contradicted it — the row below is what would have.

## Happy paths

- `Mod+B` at a collapsed caret then a keystroke: the byte lands wrapped, `**X**` in the source,
  and the character renders inside a `strong` element
- `Mod+B` then `Mod+I` then a keystroke: both marks ride the one insertion, `***X***`
- a mark pended inside existing bold REMOVES it: the byte escapes the construct and the source
  carries two balanced pairs around a plain character
- the insertion that spends a mark is its own undo entry: one `Mod+Z` after a burst plus a
  toggle plus a keystroke returns the burst's text, not the empty block

## Edge cases

- `Mod+B` then click away: the source is byte-identical to before the chord — the empty pair the
  other modes materialize is exactly what live must never write
- the mark is spent by ONE insertion: the second keystroke extends the construct the first one
  made, by the ordinary arrival rule, rather than wrapping a second pair of its own
- an arrow step clears the mark: the caret moved, so the promise no longer applies to it
- a click clears the mark, the same way it clears the arrival side

## IME commits

- a composition committed after `Mod+B` lands wrapped, exactly as a keystroke would — the
  composed run is the insertion the mark was pending for

## User interactions

- Real chords, keystrokes, clicks and a real CDP composition only: the mark is set at the
  command seam and spent inside the keydown dispatch and the composition funnel, and a
  programmatic write would bypass both
- The mark state is editor-internal and never asserted directly; every scenario reads the
  bytes it produced

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
