# Feature: a margin click beside a container's line lands on that line

A quote, a list, an alert, a footnote and a details body all hold their lines as child blocks
inside a box of their own. A click in the margin beside any of those lines puts the caret on the
line it's level with, the same as a click beside a top-level paragraph, however deep the line
sits. The margin is the editor's own padding, the container's edge (a quote's bar), or the
strip just left of the text.

## Happy paths

- Click beside a quote's third line, in source and live mode, at the editor's edge, at the
  quote's edge and just left of the text, then type: the character lands at the start of the
  third line.
- Click at the editor's edge beside a nested list's second item, in both modes, then type: the
  character lands at the start of that item.
- Click at the editor's edge beside the second line of an alert, a footnote and a details body,
  in both modes, then type: the character lands at the start of that line.

## User interactions

- Drag from the first paragraph into the editor's edge beside a quote's third line: the range
  ends where a click at that spot puts the caret, not back in the paragraph it started in.

## Edge cases

- A container with a text row of its own (an alert's title) keeps a click level with that row;
  only a click level with a child line goes to the child. Pinned in a unit test
  (`test/selection/nearest-block.test.ts`), since no fixture here has both.
- The indent beside a nested list's line holds that line's drag handle, so the editor's edge is
  the only margin there, and a click on the handle belongs to the handle.

## Miss-analysis

- Every margin-click test clicked beside a top-level line or below the document, where the
  point meets the line's own box, so no test clicked beside a container's later line, where the
  click went to the container's first line and was declined.
