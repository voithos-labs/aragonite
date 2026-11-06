# Feature: the editor under the real iOS keyboard

The rows in `scripts/mobile/ios-rows.mjs`, which `.github/workflows/mobile-input.yml` runs in
Mobile Safari on the iOS Simulator through Appium. Taps are native taps and keys are taps on the
on-screen keyboard. Each bullet's name before the colon is the row's key, and
`mobile-rows-lockstep.test.ts` holds the two lists to each other.

## Keyboard

- types a word through the on-screen keyboard: a tap on a paragraph brings up the keyboard, and
  tapping its keys types `hello` at the caret. Every event is trusted, and the same word sent
  by WebDriver's `sendKeys` (untrusted) is told apart.

## Touch selection

- a long press makes the editor's range: a long press on the first word turns the word Safari
  picked into the editor's own range. The editor paints it, no native range stands under it (so
  Safari draws no handles and shows no menu of its own), the editor draws its two handles, and
  its toolbar is the only menu. Safari writes its word back just after the press ends, and that
  write is adopted, not left standing.
- a long press beside a range across blocks ends it: a long press on a word below a range across
  the first two leaves that word as the editor's range, painted in its own block alone, with the
  same handles and menu. Safari ends a long press with a late `pointerup`, which must not clear
  the word it just selected.
  - Miss-analysis: no row long-pressed, and the tap rule read only the press's end.
- a range across blocks shows only the editor's handles: a range set across the first two blocks
  leaves no native range for Safari to draw its own handles on, and the editor draws two (the
  screenshot shows no Safari handles).
- the end handle drags a long-pressed word into the next block: a drag from the editor's end
  handle on the first word into the next block ends the range there, with no native range left
  beside the painted one.
- a long press in a table cell makes the editor's range: the word Safari picked in the cell
  becomes the editor's own range at the cell's path, painted with the editor's two handles and no
  native range under it, and the toolbar is the only menu, Safari's callout gone.
  - Miss-analysis: the touch lane ran its cell row on Android only, so nothing saw a cell keep
    Safari's word and callout on iOS.
- the cell menu button deletes a row: a tap in a table cell shows the cell menu's button at that
  cell; tapping it opens the cell menu, and its Delete row takes the row. iOS fires no
  `contextmenu` on a long press, so it's the one touch route to the row and column actions.
  - Miss-analysis: the row's table held one body row, which a table always keeps, so Delete row
    was disabled and a working menu read as a broken one; the Playwright row used two body rows.
- the end handle joins a tall outline a line past its edge: on the page with plugins, the end
  handle of a long-pressed word dragged a little more than a line into a table of contents below
  it (far short of its middle) takes the outline into the range.
- the toolbar's copy fills the pasteboard: after a long press on a word, the toolbar's Copy puts
  the word on the system pasteboard, though no native range stands under it.
