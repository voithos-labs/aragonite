# Feature: Table block, the cell menu button under a finger

On a touch screen a long press in a cell makes its word the editor's range with the selection
toolbar over it, so it opens no cell menu. A finger reaches the row and column actions through a
button at the focused cell instead. It shows only after a finger's press (a mouse has the
right-click and Shift+F10), never in reading mode, and takes no focus, so the cell keeps its caret.

## Happy paths

- A finger's tap in a cell shows the button, centred on that cell's top-right corner, named
  "Table actions". A tap in another cell moves it there.
- Tapping the button opens the cell menu, and its Delete row takes the focused cell's row. The
  button never takes focus.
  - Miss-analysis: the touch takeover's cell row asserted the long press's cell menu, which a
    finger then lost, and iOS never had one; no row reached the row and column actions by touch.

## Edge cases

- A finger's long press in a cell (a `contextmenu` after a touch press) opens no menu, the cell
  keeping focus.
- A mouse's click in a cell shows no button, and a finger's tap after it brings it back.
- Reading mode shows no button.
