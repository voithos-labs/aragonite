# Feature: a format toggle over a cross-block range

A cross-block range decomposes into one span per block — the anchor block's tail,
each middle block's whole content, the focus block's head — and each span goes
through the same single-block toggle seam. Direction is the range's own coverage:
every span already carrying the mark unapplies, anything else applies. The whole
press is ONE undo entry. Blocks that cannot host the mark are skipped and the
press still lands on the ones that can. The link editor stays declined: it mints
over one block's offsets and a range gives it no one block to mint into.

## Happy paths

- `Mod+B` over a whole-document range of two plain paragraphs wraps each block on
  its own, in source and in live mode
- `Mod+B` over two already-bold paragraphs unwraps both: every span is covered, so
  the press is an unapply everywhere
- one bold paragraph and one plain one is an APPLY, so the plain block wraps and
  the bold one is left byte-identical — the single-block seam decides its own arm
  from each span alone, and without the range's direction pinned the covered block
  would toggle the other way

## Edge cases

- a fenced code block between two paragraphs keeps its bytes while both paragraphs
  wrap: participation is the kind's own declaration (inline-bearing, editable, not
  a container), never a name
- a PARTIAL range, built by placing the caret mid-word and shift-clicking on a word
  start in the block below, marks each endpoint's own span and trims the space at the
  head span's edge: markdown cannot close a run against whitespace, so an untrimmed
  edge writes delimiters that form no construct and the block is silently skipped
- a document long enough to window marks the blocks the DOM never mounted too: the
  commit takes the document scope, so a block with no mounted container is still a
  byte write on the live tree
- `Mod+K` with a painted cross-block range whose anchor sits inside a link opens no
  card and edits no bytes, and the range survives: the cross-block entry parks a
  COLLAPSED native caret at the anchor, so a native-collapse check alone reads the
  range as an ordinary caret. The chord's create half (#119) declines the same
  range at its own `canOpenCreate` door — cross-block is absolute for both
- the range is built the way a user builds it — a caret, then `Mod+A` twice — so
  the cross-block selection is real and not a programmatic construction
- a consumer `keybindings` override moves the strong toggle onto a chord the
  keystroke swallow does not know (`Mod+Alt+G`), pressed over the same range: the
  press reaches the block's own dispatch and the seam routes it to the cross-block
  arm there, so the bytes move exactly as the default chord's do. This is the one
  gesture that proves the leaf THREADS the arm, since every default chord is
  claimed one layer earlier
- plain typing over the same cross-block range still replaces it, and one undo
  restores the document, so the toggle narrowed nothing else

## Error cases

- one undo after the press restores both blocks: the whole range is one entry, not
  one per block
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
  rebound format chord over a range. The route now lives at the id-keyed dispatch
  seam every entry path crosses; the chord arm this file exercises is the keystroke
  claim that keeps the browser's own bold off the range.
- The seam's flag was pinned only where a hand-built context supplied it, so a leaf
  handing the seam a constant `false` broke nothing: the rebound-chord gesture above
  is the one route from a real keypress to the flag — and now the arm — the leaf
  actually threads.
