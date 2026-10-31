# Feature: the editor under a real Android touch screen and keyboard

The rows in `scripts/mobile/android-rows.mjs`, which `.github/workflows/mobile-input.yml` runs on
an Android emulator with Chrome and Gboard. Every tap, swipe and key is a touch on the device;
the page connection only seeds the document and reads the result. Each bullet's name before the
colon is the row's key, and `mobile-rows-lockstep.test.ts` holds the two lists to each other.

## Keyboard

- types a word through Gboard: a tap puts the caret at the end of a paragraph, and tapping
  Gboard's own keys types `hello` there. Every keydown is a trusted keyCode 229 with key
  `Unidentified`, and the same word sent by `adb shell input text` (named keys) is told apart.

## Touch selection

- a swipe after a tap keeps the caret: after a tap, a swipe up that starts on the next
  paragraph's text scrolls, and the caret stays where the tap put it, collapsed.
  - Miss-analysis: no test exercised touch at all, because nothing read `pointerType`.
- a swipe keeps a range across blocks: a swipe that starts on a paragraph below a range across
  the first two scrolls and leaves the range exactly as it was, as Android does with its own
  selection.
- a tap clears a range across blocks: a tap on a paragraph below the range puts a collapsed caret
  there. Both gestures land clear of the range's formatting toolbar, which takes a tap as a
  command.
