# Feature: A removal keeps a blank line the range took above the rest

A range from a block taken whole, flush under a paragraph, into a paragraph a blank line below,
takes that blank line with it. What's left of the lower paragraph stays a paragraph of its own,
a blank line under the paragraph above, instead of running on into it. Flush on both sides of
the taken block, the two still rejoin as prose.

## Happy paths

- `first / *** / (blank) / para`, a range from the divider to inside `para`, Delete: the source
  reads `first / (blank) / ra`, and a letter typed then goes before `ra`, in source and live mode.
- The same range and a typed `Q`: `first / (blank) / Qra`.
- `first / # head / (blank) / para`, a range from the heading's first byte to inside `para`,
  Delete then a letter, or a typed `Q`: the same bytes, in source mode.
- `Run this: / ```sh / npm i / ``` / (blank) / Then do that.`, a range from the fence's first byte to
  after `Then `, Delete then a letter, or a typed `Q`: `Run this: / (blank) / xdo that.` and
  `Run this: / (blank) / Qdo that.`, in source mode.

## User interactions

- The range from the heading or the fence is a caret at the block's first byte, then a Shift+click
  into `para`; the one from the divider is a caret in `para`, then a Shift+click on the divider.

Miss-analysis: the jsdom rows pinned the lower side as running on, and no Chromium row mounted a
block taken whole flush under a paragraph, so the rest joining the paragraph above went unseen.
