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
- a long press makes the editor's range: a long press on the first word turns the word Chrome
  picked into the editor's own range. The editor paints it, no native range stands under it, the
  editor draws its two handles, and its toolbar is the only menu: neither Chrome's floating menu
  nor the editor's clipboard menu shows (the screenshot shows no browser handles).
- a long press beside a range across blocks ends it: a long press on a word below a range across
  the first two leaves that word as the editor's range, painted in its own block alone, with the
  same handles and menu.
  - Miss-analysis: no row long-pressed; the #806 rows only swiped and tapped.
- the toolbar's cut takes the long-pressed word: after that long press, the toolbar's Cut cuts the
  word, and the first two blocks keep their text.
- the toolbar's paste puts a copied word in place of another: the toolbar's Copy on a long-pressed
  word, then its Paste on a word long-pressed further down, puts the first word where the second
  was. Chrome asks once before the page reads the clipboard; the row taps Allow, and the first
  Paste still lands.
  - Miss-analysis: no phone row tapped Paste, and the desktop rows run with the clipboard
    permission already granted, so nothing met Chrome's prompt.
- the end handle drags a long-pressed word into the next block: a swipe from the editor's end
  handle on the first word into the next block grows the range there. The page hears the swipe's
  press, so the finger landed on the editor's handle, and no native range stands beside the
  painted one.
- a long press in a table cell keeps the browser's word and opens the cell menu: the word Chrome
  picked in the cell stays native, and the cell menu (with its row and column actions) is the one
  menu there. The toolbar doesn't show, and Chrome draws no menu of its own.
