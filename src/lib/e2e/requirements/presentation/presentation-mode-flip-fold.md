# Feature: a presentation-mode flip folds an open source reveal

A mode switch counts as a blur. An inline source reveal holds the block's live
bytes in temporary DOM the CST has never seen, and the switch's re-render
replaces those children, so the switch has to go through the one place a blur
commits them, on every switch and not only the one into reading. Otherwise the
reveal's edit is discarded where a blur would have committed it.

Driven on `/test/plugins?seed=math`, whose `$…$` kind declares `revealSource`;
the switch is the host writing the `presentationMode` prop, which is the
consumer-facing gesture the demo's toggles also produce.

Miss-analysis (E-F4): every mode-switch scenario switches with nothing revealed,
so nothing ever watched an open reveal cross a switch. That hid two faults at
once: the blur lived only in the reading branch, and even that branch ran after
the mode's render key had rebuilt the block and erased the very edit the blur was
there to commit.

## Happy paths

- an edit typed into a revealed source is committed by a switch to live, and the
  document holds the edited bytes afterwards
- the same holds switching into reading, the branch that already carried a blur

## Edge cases

- a reveal opened but not edited commits nothing across a switch: the bytes are
  byte-identical afterwards

## User interactions

- the reveal is opened by a real gesture (caret past the widget, one Backspace)
  and edited by real typing before the switch

## Error cases

- zero `[invariant:…]` console fires and no captured page errors across every
  scenario
