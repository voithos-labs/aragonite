# Feature: the party parrot block

A `%%parrot` line renders as an animated ASCII party parrot with the bytes after the marker as
its caption. The line is a render-primary leaf: at rest the caption is the block's view, a click
on it, or the caret walking in, swaps it for the source line, and leaving the block turns the
source back into a caption and commits the edit once. Seed `parrot`: block 0
`%%parrot party responsibly`, block 1 `After`, somewhere to put the caret and to blur to.

## Happy paths

- Seed render: block 0 shows one `.parrot-block` holding the bird's clip window (`.parrot`) and
  a `.parrot-caption` reading `party responsibly`; no `.parrot-source` is mounted, and the
  `%%parrot party responsibly` bytes stay in the source. The strip inside the window
  (`.parrot-reel`) is exactly ten windows tall, so a step lands on the next frame rather than
  part way into it.
- The bird dances: the reel's transform moves on its own, with no gesture, and two samples taken
  across a wait differ.
- The dance moves no byte: the block's whole text is unchanged across six frame periods, over a
  span in which the reel provably moved. Every frame is in the DOM at once and CSS chooses which
  one shows, so nothing a user, or a test comparing block text across a mode switch, can see
  changes with the animation.

## User interactions

- A click shows the source: a click on the caption mounts `.parrot-source` holding the whole
  line, marker included, with the caret in it, and unmounts the caption; the bytes are untouched,
  since only what is shown changed.
- Click position: the source opens with the caret at the character clicked, past the marker, and
  a click further right along the caption lands further along the source.
- Click the bird: the whole rendered block opens the source, so a click on the ASCII art shows
  the source with the caret in it and the bytes untouched.
- Edit and leave: typed characters stay in the source line until the caret leaves the block
  (ArrowDown into `After`); leaving closes the source, the caption shows the new text, and the
  document holds the typed bytes, round-trip stable.
- Deleting back to the bare marker and then leaving gives an empty caption; the block stays a
  parrot and the frame keeps dancing.
- Arrow in and out: ArrowLeft from the start of `After` shows the source with the caret in the
  parrot; ArrowRight from the end of the source closes it and puts the caret back in `After`.
- Enter at the end of the caption: the source closes and an empty paragraph opens below with the
  caret in it, the caption unchanged and the bytes reading
  `%%parrot party responsibly\n\n\nAfter\n`, the shape a heading's Enter writes at the same
  offset.
- Enter mid-caption: the tail moves into the paragraph below, so the caption reads `party` and
  the bytes read `%%parrot party\n responsibly\n\nAfter\n`, round-trip stable.
- Enter after emptying the caption: the commit writes the emptied line and the split runs on
  those bytes, giving `%%parrot\n\n\nAfter\n` with an empty caption and the bird still dancing.
- Typing the marker then Enter: emptying `After` and typing `%%parrot` turns the block into a
  parrot with its source shown, and Enter then leaves an empty paragraph below with the caret in
  it.

## Edge cases

- One undo entry per cycle: showing the source, editing and leaving, with typing that spans an
  undo batch pause, undoes in one step back to the seed, with the caption reading the old text.
- One undo entry for a commit and split together: Enter after an edit closes the source and
  splits on the same press, and the commit is still inside its undo batch when the split lands,
  so one undo goes back to the seed.
- Reading mode: no `.parrot-source` anywhere, the caption stays, and a click on it shows
  nothing.
- Reduced motion: under `prefers-reduced-motion: reduce` the reel's transform holds still across
  the same wait and sits at the top of the strip, so the bird rests on a whole frame rather than
  between two.
- Phone width: at a 320px viewport every frame is wider than the text column, so the `.parrot`
  window overflows while the editor root's `scrollWidth` still equals its `clientWidth`: the
  bird scrolls, the document does not.

## Error cases

- What happens with the plugin not installed is a unit concern
  (`test/plugins/parrot/round-trip.test.ts`): without it, `%%parrot …` is an ordinary paragraph.
  The e2e runs only with the plugin installed and asserts that no console errors are captured
  across any gesture.

## Miss-analysis

- The source line that was always mounted: the old spec pinned the plain shape the parrot
  shipped with, a click straight into the source and the caption updating per keystroke, so the
  presentation-mode rule that a plugin hides its markers when unfocused had no test naming the
  parrot, and the doubled caption only ever showed on the demo.
- Reading mode: no parrot test switched the mode, so a source line that merely went inert, with
  contenteditable off and still on screen, was never asserted against.
- Undo granularity: the old spec never pressed undo, so the per-keystroke batches the plain leaf
  pushed were never counted against the one-entry promise the closure now makes.
- Enter: every parrot case typed into the caption and left by arrow or click, so no test ever
  pressed Enter in the block, and the leaf factory's own cases were all written against
  multi-line kinds where the newline Enter inserts is visible and wanted.
- Click position: every case that showed the source asserted only that it mounted, so the offset
  the click handler passed was never read back and a hardcoded 0 satisfied all of them.
- The bird: no scenario ever clicked anywhere in the block but the caption, so the half of the
  rendered view carrying no handler was never asked to do anything.
- The dance against the bytes: every bird scenario asserted that the frame changed and none that
  anything else held still, so a block whose own text moved fourteen times a second read as
  working here while it broke a presentation spec elsewhere (#280). The general miss: an
  animation was only ever asserted from the side that wanted it.
- Reduced motion: no parrot scenario ever ran with a media preference set, so a bird that danced
  through `prefers-reduced-motion: reduce` had nothing to fail.
- Containment: every scenario ran at the config's pinned 1280 viewport, where the widest frame
  still fits the text column, so no test ever put a block beside a column narrower than its own
  content and the sideways scroll only ever showed on a phone.
