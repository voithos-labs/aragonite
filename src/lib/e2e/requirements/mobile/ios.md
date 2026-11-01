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

- a long press beside a range across blocks ends it: a long press on a word below a range across
  the first two leaves the word selected and nothing of the old range painted. Safari ends a long
  press with a late `pointerup`, which must not clear the word it just selected.
  - Miss-analysis: no row long-pressed, and the tap rule read only the press's end.
- a range across blocks shows only the editor's handles: a range set across the first two blocks
  leaves no native range for Safari to draw its own handles on, and the editor draws two (the
  screenshot shows no Safari handles).
- a long press's edge handle crosses into the next block: a long press on the first block's last
  word, then a drag on the editor's handle beside Safari's into the next block, ends the range
  there with no native range left beside the painted one.
