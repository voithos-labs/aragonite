# Feature: block math navigation at every edge

A `$$` block is a render-primary leaf: the caret enters it by showing the source and leaves it by
closing it again. Live mode paints that source like a code block's with the fence lines hidden,
so the offsets the caret may sit at are the body's; source mode paints the fences, so the ends of
the raw text may be sat at too. Every way in and out reads those bounds, in both modes, from
either side, vertically and horizontally.

Fixture: `Before` / a four-line `aligned` block / `After` (`?seed=mathblock-multiline`), driven
in `live` and in `source`.

## Happy paths

- ArrowRight from the end of the block above shows the source with the caret at the first offset
  it may sit at (the body's start in live, byte 0 in source); ArrowLeft there closes it and
  lands in the block above
- ArrowLeft from the start of the block below shows the source with the caret at the last such
  offset (the body's end in live, the source's end in source); ArrowRight there closes it and
  lands below
- ArrowDown from above shows the source and walks the four body lines in live, then leaves
  below, and ArrowUp does the same in reverse. Source mode paints the fence lines too, so
  entering from above with a sticky column lands on the second line rather than on the `$$`
  line, which is a question about column landing that this file does not pin

## Edge cases

- An empty block (`$$$$`) in live mode: showing the source completes it to an opener, an empty
  body line and a closer; ArrowRight from above enters it, a second ArrowRight leaves below, and
  the completion commits as the source closes (`Before / $$ / (blank) / $$ / After`). ArrowLeft
  from below enters the same way, and a second ArrowLeft leaves above. The far side of the empty
  line is the hidden closer's line, which nothing paints, so the traversal's last allowed offset
  stops before that newline; otherwise the checks at the block's end never fire and the caret is
  stuck on the empty line

## Miss-analysis

- The block's arrow scenarios ran on the one-line `$$x^2$$` seed in source mode only, where
  every raw offset can take the caret and there is a single visual line, so a hidden fence line
  at either end and a body of several lines had no scenario in the mode that paints neither
  fence.
