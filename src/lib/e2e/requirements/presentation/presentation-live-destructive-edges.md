# Feature: live-mode destructive edges (what a Backspace takes when the markers are gone)

Live paints no delimiter and reveals none, so the byte a destructive key would take beside a
construct is one the reader never saw. Worse, the engine takes the whole non-rendered span along
with the character it deletes (measured), so a press at either end of a construct destroys it.
The contract: a destructive key beside a hidden run takes the adjacent CONTENT character, a pair
the cut empties goes with it in the same commit — invisible `****` residue is never written — a
run whose bytes mean nothing apart goes as one unit, and a press with no sound rewrite takes
nothing rather than letting the engine paint the delimiters. Driven on `/test/editor` via
`?presentationMode=live` with real keystrokes and real clicks; the SOURCE is the oracle, since
nothing on screen distinguishes bytes that are hidden from bytes that are gone.

## Happy paths

- `Backspace` after a bold word's last character deletes that character and leaves the construct
  standing: the word shortens, the bold survives, no `*` appears on screen
- `Backspace` on the FIRST content character keeps the construct too — the adjacency that decides
  is the deleted byte's, not the caret's, so both ends of a construct are covered
- deleting the LAST content character of a bold construct removes its delimiter pair in the same
  commit, and `****` never exists in the source at any point in the gesture
- one `Mod+Z` after that restores both the character and the pair — the cut is one undo entry,
  not a delete plus an unwrap
- `Backspace` beside an escape takes the whole `\*` pair: the backslash the reader never saw does
  not survive its escaped character

## Edge cases

- `Backspace` at the start of a hard-broken line takes the break as one unit — its marker run and
  its line ending — rather than leaving a literal backslash where the break was
- a press between two constructs takes the WIDENED cut: deleting the space in `**a** **b**`
  leaves `**a****b**`, which renders `a****b`, so the cut grows through the delimiter runs it now
  sits between and the two words become one bold — the reading a reader would call obvious
- a press whose readings would BOTH surface delimiters takes nothing: `**a *b* c**` backspaced
  before the nested emphasis has neither a plain nor a widened rewrite that parses back, so the
  bytes are left exactly as they were. Declining to the engine is not an option there — it
  deletes both constructs and paints the stars
- source mode is unaffected: the same gesture over the same bytes deletes the one byte the caret
  is against, delimiters included, because there they are painted and the user aimed at them

The blast radius of that swallow is a decision, not a corner case: over a 15-fixture corpus of
the shapes this spec and its unit suite drive (414 presses, both directions at every offset), the
arm claims 239 presses and swallows 18 of them — down from 28 before the widened cut existed. A
swallowed press is one where markdown cannot express the result; the alternative is the engine's
version, which surfaces markers.

## User interactions

- Real keystrokes, real arrow walks and real clicks only: the arm lives inside the keydown
  dispatch, and a programmatic write would bypass both it and the engine behavior it stands in
  front of
- Every assertion reads the source through the bridge; the rendered element is asserted only
  where "still bold" is the claim

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
