# Feature: live-mode link card — the chord's consumption contract

`reservedChords()` reports `Mod+K` as a chord this editor takes, so every seat it can be pressed
from must consume the press — whether or not anything opens. Declining would hand a host-forbidden
chord back to the browser's own `Mod+K` defaults: Chrome's omnibox, and on macOS the contenteditable
kill-to-end-of-line the `Mod` fold routes there. Consumption is read as `defaultPrevented` at a
document BUBBLE listener, after every editor handler has run. The card's own surface is
`live-link-card.md`; the create half is `live-link-card-create.md`.

## Happy paths

- a caret outside every link consumes the press: `reservedChords()` reports the chord as one this
  editor takes, so declining it would hand a host-forbidden chord back to the browser
- the same press is consumed in source mode with the caret inside a link — source paints the
  destination already, so the chord has nothing to do, which is not the same as handing the key back

## Edge cases

- a fenced code block consumes the press, where no inline construct exists to open a card on
- the open card's own URL field consumes it, swallowing the chord as re-asserting the entry the
  focus is already in

## Error cases

- no seat writes a byte: the source after each press is byte-identical to the source before it
- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
