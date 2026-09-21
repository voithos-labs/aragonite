# Feature: live-mode destructive edges (what a Backspace takes when the markers are gone)

Live mode paints no delimiter and shows none, so the byte a destructive key would take beside a
construct is one the user never saw. Worse, the browser takes the whole unrendered span along
with the character it deletes (this was measured), so a keypress at either end of a construct
destroys it. The contract: a destructive key beside a hidden run takes the adjacent content
character; a pair the cut empties goes with it in the same commit, so an invisible `****` is
never written; a run whose bytes mean nothing apart goes as one unit; and a keypress with no
sound rewrite takes nothing rather than letting the browser paint the delimiters. Driven on
`/test/editor` via `?presentationMode=live` with real keystrokes and real clicks; the source is
what each scenario checks against, since nothing on screen tells bytes that are hidden from
bytes that are gone.

## Happy paths

- `Backspace` after a bold word's last character deletes that character and leaves the construct
  standing: the word shortens, the bold survives, no `*` appears on screen
- `Backspace` on the first content character keeps the construct too: what decides is what the
  deleted byte is next to, not what the caret is next to, so both ends of a construct are covered
- deleting the last content character of a bold construct removes its delimiter pair in the same
  commit, and `****` never exists in the source at any point in the gesture
- one `Mod+Z` after that restores both the character and the pair: the cut is one undo entry,
  not a delete plus an unwrap
- `Backspace` beside an escape takes the whole `\*` pair: the backslash the user never saw does
  not survive its escaped character
- a chorded word delete after a bold word takes the delimiter pair with the word: the range it
  rewrites is reported on the event while the caret is still collapsed, so it never reaches the
  caret-edge handler at all. Miss-analysis: every scenario here and in the unit suites pressed an
  unmodified key, so no case exercised the block's `beforeinput` handler, whose two checks both
  failed open, one on the empty selection and one on a three-element list of input types

## Edge cases

- `Backspace` at the start of a hard-broken line takes the break as one unit, its marker run and
  its line ending together, rather than leaving a literal backslash where the break was
- `Backspace` at the first offset the block can land on is a block gesture: in a block opening
  with an escape (`\*c\*`) that offset sits inside the escape, and the keypress merges into the
  previous block with the escaped glyph intact. Miss-analysis (GH #108): the suites for this
  handler drove keypresses beside constructs but never at the first landable offset, so the
  escape's edge rule ate the first visible glyph forward where every other shape merged
- a keypress between two constructs takes the widened cut: deleting the space in `**a** **b**`
  leaves `**a****b**`, which renders `a****b`, so the cut grows through the delimiter runs it now
  sits between and the two words become one bold, which is the reading a user would call obvious
- a keypress whose two readings would both bring delimiters on screen takes nothing: `**a *b* c**`
  backspaced before the nested emphasis has neither a plain nor a widened rewrite that parses
  back, so the bytes are left exactly as they were. Handing the key to the browser is not an
  option there, since it deletes both constructs and paints the stars
- source mode is unaffected: the same gesture over the same bytes deletes the one byte the caret
  is against, delimiters included, because there they are painted and the user aimed at them

Where the plain cut is sound, this handler deliberately differs from the browser rather than
matching it: the browser joins whatever spans touch the deletion, so `[a](u) [b](v)` becomes one
link and one of the two URLs is gone, and a bold beside a code span merges into whichever the
browser picks. The handler keeps both constructs and takes only the character. The widened cut is
the one case where the two agree, and it agrees because it was checked, not because it was copied.

How often a key gets swallowed is a decision, not a corner case: over a 15-fixture corpus of the
shapes this spec and its unit suite drive (414 keypresses, both directions at every offset), the
handler takes 239 keypresses and swallows 18 of them, down from 28 before the widened cut
existed. A swallowed keypress is one where Markdown cannot express the result, and the
alternative is the browser's version, which brings markers on screen.

## User interactions

- Real keystrokes, real arrow steps and real clicks only: the handler lives inside the keydown
  dispatch, and a programmatic write would bypass both it and the browser behavior it stands in
  front of
- Every assertion reads the source through the bridge; the rendered element is asserted only
  where "still bold" is the claim

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
