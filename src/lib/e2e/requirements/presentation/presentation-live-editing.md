# Feature: live-mode destructive editing (what a Backspace takes when the markers are gone)

Live paints no delimiter and reveals none, so the byte a destructive key would take beside a
construct is one the reader never saw: `Backspace` past a bold word's last character would eat a
`*` and surface the rest. The contract: a destructive key at a hidden run takes the adjacent
CONTENT character, a pair the cut empties goes with it in the same commit — invisible `****`
residue is never written — and a run whose bytes mean nothing apart (an escape, a hard break)
goes as one unit. Driven on `/test/editor` via `?presentationMode=live` with real keystrokes and
real clicks; the SOURCE is the oracle, since nothing on screen distinguishes bytes that are
hidden from bytes that are gone.

## Happy paths

- `Backspace` after a bold word's last character deletes that character and leaves the construct
  standing: the word shortens, the bold survives, no `*` appears on screen
- deleting the LAST content character of a bold construct removes its delimiter pair in the same
  commit, and `****` never exists in the source at any point in the gesture
- one `Mod+Z` after that restores both the character and the pair — the cut is one undo entry,
  not a delete plus an unwrap
- `Backspace` beside an escape takes the whole `\*` pair: the backslash the reader never saw does
  not survive its escaped character

## Edge cases

- `Backspace` at the start of a hard-broken line takes the break as one unit — its marker run and
  its line ending — rather than leaving a literal backslash where the break was
- source mode is unaffected: the same gesture over the same bytes deletes the one byte the caret
  is against, delimiters included, because there they are painted and the user aimed at them

## User interactions

- Real keystrokes, real arrow walks and real clicks only: the arm lives inside the keydown
  dispatch, and a programmatic write would bypass both it and the engine behavior it stands in
  front of
- Every assertion reads the source through the bridge; the rendered element is asserted only
  where "still bold" is the claim

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
