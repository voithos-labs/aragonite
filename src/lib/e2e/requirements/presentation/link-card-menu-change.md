# Feature: Live mode, the link card on `menuChange`

The link card live mode anchors under a link is a popover over the document, so it reports on
`menuChange` like the editor's menus.

## Happy paths

- A click on a link opens the card and the channel reads `true`; Escape closes it and the
  channel reads `false`, once each.

## Miss-analysis

- The silent link card (#370) shipped because the event was emitted only from the right-click
  menu's own open state, and no link card spec subscribed to it.
