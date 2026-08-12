# Feature: a format toggle over a cross-block range declines

A cross-block range has no single block to rewrite, so no format command can run
over it. The chord used to fall through to the type-replace arm, which reads any
unhandled key as text: the range was deleted and an empty `**` pair materialized
at the collapsed caret, leaving the document `****` and an undo that came back
`\n` (#107). The toggle is CONSUMED instead — the chord is claimed so nothing
downstream retypes it, and not a byte moves. Its sibling, plain typing over the
same range, must stay exactly as destructive as it was.

## Happy paths

- `Mod+B`, `Mod+I` and `Mod+E` over a whole-document range leave the source
  byte-identical, in every mode a marker-hiding mode changes nothing about
- `Mod+Shift+X` (strikethrough) declines the same way — the shifted chord reaches
  the same door
- `Mod+K` with a painted cross-block range whose anchor sits inside a link opens
  no card and edits no bytes, and the range survives: the cross-block entry parks
  a COLLAPSED native caret at the anchor, so a native-collapse check alone reads
  the range as an ordinary caret. The chord's create half (#119) declines the
  same range at its own `canOpenCreate` door — cross-block is absolute for both
- plain typing over the same cross-block range still replaces it, and one undo
  restores the document, so the decline narrowed the toggle and nothing else

## Edge cases

- the decline is a consumption, not an ignore: `defaultPrevented` is true on the
  chord's own keydown, read from a document-level bubble listener that runs after
  the block handler
- the range is built the way a user builds it — a caret, then `Mod+A` twice — so
  the cross-block selection is real and not a programmatic construction
- a consumer `keybindings` override moves the strong toggle onto a chord the
  keystroke swallow does not know (`Mod+Alt+G`), pressed over the same
  whole-document range: the press reaches the block's own dispatch and the seam
  declines it there, so no edit event fires and the source is byte-identical.
  This is the only gesture that proves the leaf THREADS the live range flag,
  since every default chord is swallowed one layer earlier

## Error cases

- a declined chord pushes no undo entry: one undo after it must not walk past the
  document load
- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)

## Miss-analysis

- The unit suite pinned the destructive route as the CONTRACT ("deletes the range
  then dispatches") behind a mocked command target, and no e2e ever pressed a
  format chord over a cross-block range, so the `****` document showed nowhere (#107).
- The #107 sweep enumerated the format chords by hand and stopped at the four;
  `Mod+K` binds at the same keymaps but joined no consumed set and no spec pressed
  it over a range, so the card opened over a painted selection.
- The decline was keyed on the DEFAULT chords, so a consumer rebind or an id-keyed
  dispatch walked past it into the single-block arms (#127), and no test drove a
  rebound format chord over a range. The decline now lives at the id-keyed dispatch
  seam every entry path crosses; the chord arm this file exercises is the keystroke
  swallow that keeps the browser's own bold off the range.
- The seam's flag was pinned only where a hand-built context supplied it, so a leaf
  handing the seam a constant `false` broke nothing: the rebound-chord gesture above
  is the one route from a real keypress to the flag the leaf actually threads.
