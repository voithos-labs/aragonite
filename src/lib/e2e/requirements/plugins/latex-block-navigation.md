# Feature: block math navigation at every edge

A `$$` block is a render-primary leaf: the caret enters it by revealing the source and leaves it
by folding. Live mode paints the source like a code block's, with the fence lines hidden, so the
landable bounds are the body's; source mode paints them, so the raw's ends are landable. Every
door reads those bounds, in both modes, from either side, vertically and horizontally.

Fixture: `Before` / a four-line `aligned` block / `After` (`?seed=mathblock-multiline`), driven in
`live` and in `source`.

## Happy paths

- ArrowRight from the end of the block above reveals the source with the caret at the first
  landable byte (the body start in live, byte 0 in source); ArrowLeft there folds and lands in
  the block above
- ArrowLeft from the start of the block below reveals with the caret at the last landable byte
  (the body end in live, the source end in source); ArrowRight there folds and lands below
- ArrowDown from above reveals and walks the four body lines in live, then leaves below;
  ArrowUp mirrors it (source mode paints the fence lines too, and its sticky entry from above
  lands on the second line rather than the `$$` line, which is a column-landing question this
  file does not pin)

## Edge cases

- An empty block (`$$$$`) in live mode: the reveal completes it to opener, empty body line and
  closer; ArrowRight from above enters it, a second ArrowRight leaves below, and the completion
  commits as the reveal folds (`Before / $$ / (blank) / $$ / After`). ArrowLeft from below enters
  the same way and a second ArrowLeft leaves above. The empty line's far side is the hidden
  closer's line, which nothing paints, so the walk's landable end stops before that newline;
  otherwise the block-end gates never fire and the caret is stuck on the empty line

## Miss-analysis

- The block's arrow scenarios ran on the one-line `$$x^2$$` seed in source mode only, where every
  raw offset is landable and there is one visual line, so a hidden fence line at either end and
  a body of several lines had no scenario in the mode that paints neither fence.
