# Feature: Image, the alt field on `menuChange`

The alt field a selected image's toolbar opens is a popover over the document, so it reports on
`menuChange`. The toolbar itself is selection chrome, shown for as long as the image is
selected, and reports nothing.

## Happy paths

- Selecting the image shows the toolbar and the channel stays quiet; opening the alt field reads
  `true`, and Escape in the field closes it and reads `false`.

## Miss-analysis

- The silent alt field (#370) shipped because the event was emitted only from the right-click
  menu's own open state, and no image spec subscribed to it.
