# Feature: Table block, the cell menu on `menuChange`

The cell menu is an editor-owned menu, so it reports on `menuChange` the way the right-click
block menu does: a host's own controls over the selection step aside while it shows.

## Happy paths

- Shift+F10 on a cell opens the cell menu and the channel reads `true`; Escape closes it and the
  channel reads `false`, once each.

## Edge cases

- A flyout opened over the menu, then swapped for the other group's flyout, keeps the menu open
  on the channel: it reads `true` once when the menu opens and `false` once when Escape closes
  the whole stack.

## Miss-analysis

- The silent cell menu (#370) shipped because the only `menuChange` spec drove the right-click
  block menu, and the event was emitted from that menu's own open state rather than from
  anything every menu shares, so a second menu had nothing to forget and nothing to test.
