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
- the toolbar's copy fills the pasteboard: after a long press on a word, the toolbar's Copy puts
  the word on the system pasteboard, though no native range stands under it.
