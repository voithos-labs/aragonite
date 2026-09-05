# Feature: placeCaretAtPoint, the host shell's caret door

A shell that owns chrome next to the document — a journal entry's padding, a card's
footer band — gets clicks the editor never sees. `editor.placeCaretAtPoint(x, y)` is
the seam: the shell decides WHETHER to answer a click on its own territory, the editor
decides WHERE the caret lands. It answers a raw viewport point with no press, no target
and no gesture in front of it, and reports whether a caret landed.

The landing is the dead-space click's own walk, so this file asserts what a CONSUMER
observes through the public method; the gesture's discrimination (press pairing, drag
release, live native range) is `dead-space-click.md`.

## Happy paths

- A point below the whole editor box — a place no click on the editor could ever
  land — puts the caret at the end of the document, and the next typed character
  appends there.
- A point beside a wrapped line puts the caret at the end of THAT line, not at the end
  of the block: the point clamps into the reading column before it resolves.
- A point over a block's own text lands there. The method is not dead-space-only; the
  shell's decision to call it is the whole gate.
- Every landing returns `true`.

## Edge cases

- A point below a document ending in a thematic break returns `false` and focuses no
  block: a rule holds no character position, and a false answer leaves the shell free
  to do something else with the click.
- A live cross-block range ends when the method lands a caret — the same range-ending
  a click carries, so the next printable key types at the caret instead of replacing
  the whole document.

## Miss-analysis

- The consumer defect that motivated the method (a journal's dead click band beside the
  text) was a HOST CSS bug, not an editor one: the shell put the reading column's inset
  on an ancestor of the editor element, so margin clicks never reached a surface the
  editor could claim. No editor test could have caught it, which is why the fix is half
  documentation (the host-scroll CSS contract) and half this method, for the chrome that
  genuinely is the shell's.
