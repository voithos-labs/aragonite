# Feature: a format toggle over a cross-block range

A cross-block range breaks into one span per block (the anchor block's tail, each
middle block's whole content, the focus block's head), and each span goes through
the same single-block toggle code. The direction comes from what the range already
covers: every span that already carries the mark is unapplied, anything else is
applied. The whole key press is one undo entry. Blocks that cannot hold the mark
are skipped and the press still lands on the ones that can. The link editor still
declines: it creates a link over one block's offsets, and a range gives it no
single block to create one in.

## Happy paths

- `Mod+B` over a whole-document range of two plain paragraphs wraps each block on
  its own, in source and in live mode
- `Mod+B` over two already-bold paragraphs unwraps both: every span is covered, so
  the press is an unapply everywhere
- one bold paragraph and one plain one is an apply, so the plain block wraps and
  the bold one is left byte-identical: the single-block code decides what to do
  from each span alone, and without the range's direction fixed the covered block
  would toggle the other way

## Edge cases

- a fenced code block between two paragraphs keeps its bytes while both paragraphs
  wrap: whether a block takes part is the kind's own declaration (inline-bearing,
  editable, not a container), never its name
- a partial range, built by placing the caret mid-word and shift-clicking on a word
  start in the block below, marks each endpoint's own span and trims the space at the
  head span's edge: markdown cannot close a run against whitespace, so an untrimmed
  edge writes delimiters that form no construct and the block is silently skipped
- a document long enough to window marks the blocks the DOM never mounted too: the
  commit runs over the whole document, so a block with no mounted container is still
  a byte write on the live tree
- `Mod+K` with a painted cross-block range whose anchor sits inside a link opens no
  card and edits no bytes, and the range survives: entering a cross-block range
  leaves a collapsed native caret at the anchor, so checking the native collapse
  alone reads the range as an ordinary caret. The chord's create half (#119) declines
  the same range at its own `canOpenCreate` check, so a cross-block range is refused
  by both
- the range is built the way a user builds it, a caret then `Mod+A` twice, so the
  cross-block selection is real and not a programmatic construction
- a consumer `keybindings` override moves the strong toggle onto a chord the
  keystroke swallow does not know (`Mod+Alt+G`), pressed over the same range: the
  press reaches the block's own dispatch, which sends it to the cross-block branch
  there, so the bytes move exactly as the default chord's do. This is the one
  gesture that proves the leaf passes the press on to that branch, since every
  default chord is taken one layer earlier
- plain typing over the same cross-block range still replaces it, and one undo
  restores the document, so the toggle narrowed nothing else

## Error cases

- one undo after the press restores both blocks: the whole range is one entry, not
  one per block
- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)

## Miss-analysis

- The unit suite pinned the destructive route as the contract ("deletes the range
  then dispatches") behind a mocked command target, and no e2e ever pressed a
  format chord over a cross-block range, so the `****` document showed nowhere (#107).
- The #107 sweep enumerated the format chords by hand and stopped at the four;
  `Mod+K` binds at the same keymaps but joined no consumed set and no spec pressed
  it over a range, so the card opened over a painted selection.
- The decline was keyed on the default chords, so a consumer rebind or an id-keyed
  dispatch walked past it into the single-block branches (#127), and no test drove a
  rebound format chord over a range. The check now sits at the id-keyed dispatch
  every entry path crosses; the chord branch this file exercises is the keystroke
  handler that keeps the browser's own bold off the range.
- The flag was pinned only where a hand-built context supplied it, so a leaf passing
  a constant `false` broke nothing: the rebound-chord gesture above is the one route
  from a real keypress to the flag, and now to the branch, that the leaf actually
  passes along.
