# Feature: the party parrot block

A `%%parrot` line renders as an animated ASCII party parrot with the bytes after the
marker as its caption. The line is a render-primary leaf: at rest the caption is the
block's view, a click on it (or the caret walking in) swaps it for the source line, and
leaving the block folds the source back into a caption and commits the edit once. Seed
`parrot`: block 0 `%%parrot party responsibly`, block 1 `After` (a plain caret and blur
target).

## Happy paths

- Seed render: block 0 shows one `.parrot-block` holding the bird's clip window
  (`.parrot`) and a `.parrot-caption` reading `party responsibly`; no `.parrot-source` is
  mounted, and the `%%parrot party responsibly` bytes stay in the source. The strip inside
  the window (`.parrot-reel`) is exactly ten windows tall, so a step lands on the next
  frame rather than a fraction into it.
- The bird dances: the reel's transform moves on its own, with no gesture; two samples
  taken across a wait differ.
- The dance moves no byte: the block's whole text is unchanged across six frame periods,
  over a span in which the reel provably moved. Every frame lives in the DOM at once and
  CSS chooses which one shows, so nothing a reader (or a test comparing block text across
  a mode flip) can see changes with the animation.

## User interactions

- Click reveals: a click on the caption mounts `.parrot-source` holding the whole line,
  marker included, with the caret in it, and unmounts the caption; the bytes are
  untouched (a view toggle).
- Click position: the reveal seats the caret at the character pressed, past the marker,
  and a press further right along the caption lands further along the source.
- Click the bird: the whole folded block is the reveal target, so a press on the ASCII
  art reveals the source with the caret in it, bytes untouched.
- Edit and leave: typed characters stay in the source line until the caret leaves the
  block (ArrowDown into `After`); the leave folds the source, the caption shows the new
  text, and the document holds the typed bytes, round-trip stable.
- Deleting back to the bare marker then leaving folds to an empty caption; the block
  stays a parrot and the frame keeps dancing.
- Arrow in and out: ArrowLeft from the start of `After` reveals the source with the
  caret in the parrot; ArrowRight from the end of the source folds it and lands the caret
  back in `After`.
- Enter at the end of the caption: the source folds and an empty paragraph opens below,
  with the caret in it, the caption unchanged and the bytes reading
  `%%parrot party responsibly\n\n\nAfter\n` — the shape a heading's Enter writes at the
  same offset.
- Enter mid-caption: the tail moves into the paragraph below, so the caption reads
  `party` and the bytes read `%%parrot party\n responsibly\n\nAfter\n`, round-trip stable.
- Enter after emptying the caption: the fold commits the emptied line and the split runs
  on those bytes, giving `%%parrot\n\n\nAfter\n` with an empty caption and the bird still
  dancing.
- Typing the marker then Enter: emptying `After` and typing `%%parrot` flips the block to
  a parrot with its source revealed; Enter then leaves an empty paragraph below with the
  caret in it.

## Edge cases

- One undo entry per cycle: a reveal, edit, leave cycle whose typing spans an undo batch
  pause undoes in ONE step back to the seed, the caption reading the old text.
- One undo entry for a commit-and-split pair: Enter after an edit folds and splits on the
  same press, and the fold's commit is still inside its undo batch when the split lands,
  so one undo goes back to the seed.
- Reading mode: no `.parrot-source` anywhere, the caption stays, and a click on it
  reveals nothing.
- Reduced motion: under `prefers-reduced-motion: reduce` the reel's transform holds still
  across the same wait and sits at the strip's top, so the bird rests on a whole frame
  rather than on none.
- Phone width: at a 320px viewport every frame is wider than the text column, so the
  `.parrot` window overflows while the editor root's `scrollWidth` still equals its
  `clientWidth` — the bird scrolls, the document does not pan.

## Error cases

- Uninstalled parity is a unit concern (`test/plugins/parrot/round-trip.test.ts`): with
  the plugin absent, `%%parrot …` is an ordinary paragraph. The e2e runs only with the
  plugin installed and asserts no console errors are captured across every gesture.

## Miss-analysis

- The always-mounted source line: the old spec pinned the plain shape the parrot shipped
  with (a click straight into the source, the caption live per keystroke), so the
  presentation-modes rule that a plugin hides its source chrome when unfocused had no
  test naming the parrot, and the doubled caption only ever showed on the demo.
- Reading mode: no parrot test flipped the mode, so a source line that merely went inert
  (contenteditable off, still on screen) was never asserted against.
- Undo granularity: the old spec never pressed undo, so the per-keystroke batches the
  plain leaf pushed were never counted against the one-entry claim the closure now makes.
- Enter: every parrot case typed into the caption and left by arrow or click, so no test
  ever pressed Enter in the block, and the leaf factory's own cases were all written
  against multi-line kinds where the newline Enter inserts is visible and wanted.
- Click position: every reveal case asserted only that the source mounted, so the offset the
  click handler passed was never read back and a hardcoded 0 satisfied all of them.
- The bird: no scenario ever pressed anywhere in the block but the caption, so the half of
  the folded view carrying no handler was never asked to do anything.
- The dance versus the bytes: every bird scenario asserted that the frame CHANGED, and
  none that anything else held still, so a block whose own text moved fourteen times a
  second read as working here while it broke a presentation spec elsewhere (#280). The
  generalized miss: an animation was only ever asserted from the side that wanted it.
- Reduced motion: no parrot scenario ever ran with a media preference set, so a bird that
  danced through `prefers-reduced-motion: reduce` had nothing to fail.
- Containment: every scenario ran at the config's pinned 1280 viewport, where the widest
  frame still fits the text column, so no test ever put a block beside a column narrower
  than its own content and the sideways pan only ever showed on a phone.
