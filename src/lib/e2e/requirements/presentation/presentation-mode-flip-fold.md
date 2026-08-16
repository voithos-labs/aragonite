# Feature: a presentation-mode flip folds an open source reveal

A mode flip is a blur-class event. An inline source reveal holds the block's
live bytes in ephemeral DOM the CST has never seen, and the flip's re-render
replaces those children — so the flip has to cross the blur choke point that
commits them, on EVERY flip and not only the one into reading. Otherwise the
reveal's edit is discarded where a blur would have committed it.

Driven on `/test/plugins?seed=math`, whose `$…$` kind declares `revealSource`;
the flip is the host writing the `presentationMode` prop, which is the
consumer-facing gesture the demo's toggles also produce.

Miss-analysis (E-F4): every flip scenario flips with nothing revealed, so no
oracle ever watched a reveal cross a flip. That hid two faults at once — the
blur lived only in the reading arm, and even that arm ran in the POST phase,
after the mode's render key had rebuilt the block and erased the very edit the
blur was there to commit.

## Happy paths

- an edit typed into a revealed source is committed by a flip to live, and the
  document holds the edited bytes afterwards
- the same holds flipping into reading, the arm that already carried a blur

## Edge cases

- a reveal opened but not edited commits nothing across a flip: the bytes are
  byte-identical afterwards

## User interactions

- the reveal is opened by a real gesture (caret past the widget, one Backspace)
  and edited by real typing before the flip

## Error cases

- zero `[invariant:…]` console fires and no captured page errors across every
  scenario
