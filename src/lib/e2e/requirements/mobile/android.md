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
- a long press beside a range across blocks ends it: a long press on a word below a range across
  the first two leaves the word selected, the browser's handles on it, and nothing of the old
  range painted.
  - Miss-analysis: no row long-pressed; the #806 rows only swiped and tapped.
- the editor menu's cut takes the long-pressed word: after that long press, the editor's own menu
  (Chrome hands the long press's menu to the page) cuts the word, and the first two blocks keep
  their text.
- a long press's edge handle crosses into the next block: a long press on the first word, the
  browser's end handle dragged to the block's end (where it stops), then, with the editor's
  long-press menu still open, a swipe on the editor's handle beside the browser's into the next
  block. The page hears the swipe's press, so the finger landed on the editor's handle, and the
  range ends in the next block with no native range left beside the painted one (the screenshot
  shows no browser handles).
- a handle swipe across cells grows a rectangle: a long press in a table cell selects its word,
  and a swipe on the editor's edge handle (the long-press menu still open) into the cell
  diagonally below selects the four cells.
