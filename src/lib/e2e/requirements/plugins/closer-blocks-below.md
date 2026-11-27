# Feature: a closer typed blocks below the construct it finishes

A `:::note` or a `$$` with nothing to close it reads as a plain paragraph, and the line that closes it can turn up any number of blocks further down. Typing that line takes every block in between into the construct, the way a reload of the same bytes reads them. Driven on `/test/plugins` with real keys; the checks read the source, the block count and whether the tree reloads as itself.

Miss-analysis: the join check after a write asked only the pair of blocks beside it, and every test put the closer right under the construct, so no row had a block in between to stop at (#684).

## Happy paths

- `:::note\n<div>\n`, Enter at the end of `<div>`, then `:::` on the new line under it: `:::note\n<div>\n\n:::\n`, one block holding the `<div>`, and the tree reloads as itself (the #684 report's own keys)
- `$$\n<div>\n\nx\n`, Enter at the end of `x`, then `$$`: one math block from the first `$$` to the one typed, and the tree reloads as itself
- `::::note\n\nx\n\n:::\n`, Delete at the start of the first line: the shortened `:::note` takes the `:::` below as its closer, one block, and the tree reloads as itself; Undo gives back the four colons and the three paragraphs, which reload as themselves too

- `:::tip T`, `body`, `:::` in source mode, `x` typed between the second and third colon (the line becomes a leaf directive), then Backspace: the bytes are as they started, the closing line taken back rather than a second one written; Undo takes the Backspace back
- the same callout, a colon deleted at the end of the run and typed back: the bytes are as they started

Miss-analysis (#851): every closer row wrote a new opener, so no row broke an opener whose closing line stayed below and put it back.

## Edge cases

- typing a line that closes nothing under an unclosed `$$` leaves the blocks as they were

## User interactions

- a real caret placement, then Enter and typed characters through the browser

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
