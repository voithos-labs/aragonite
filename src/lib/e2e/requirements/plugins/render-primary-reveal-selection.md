# Feature: a reveal click on a render-primary leaf ends a live cross-block range

A render-primary leaf (block math, the TOC, a footnote definition) reveals its source
when clicked and lands a caret in it. That is a caret-placing gesture, so it must end a
live cross-block range exactly as a click on any block does. It used to reveal without
resetting, leaving the range painted over a caret in the revealed source — where the
next Backspace deleted the whole range.

## Happy paths

- Select the whole document, then click the rendered math: the cross-block selection ends.
- Backspace after that click edits the revealed source, leaving the rest of the document.

## Edge cases

- Shift+click on the rendered view still extends the selection rather than resetting it —
  the reveal declines shift by design and the reset must decline with it.
