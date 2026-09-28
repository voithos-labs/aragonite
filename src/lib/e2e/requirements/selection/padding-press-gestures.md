# Feature: gestures that start in an editable's top padding still work

The editor places a plain click in an editable's top or bottom padding itself, since Chromium
on Mac and Linux would put it at the line's start or end. Every other gesture that starts
there behaves as it does on the line itself. Each row runs on a code block's grey box and on
a paragraph (live mode).

## Happy paths

- Double-click in the top padding above `con|st` (or `Hel|lo`): selects what a double-click
  on the line at that column selects.
- Triple-click there: selects what a triple-click on the line selects.
- Press there and drag to `const x|` (or `Hello wor|ld`): the range runs from the column
  under the press to the release.

## Edge cases

- Right-click there: the block menu opens, and the editor leaves the press to the browser.

## User interactions

- Click there, then compose `あ` with an input method and commit: it lands at the column
  (`conあst`, `Helあlo`).
- Tap there on a touch screen: the caret lands at the column, as a click does.

## Miss-analysis

- A new rule for the plain press could have broken any of these. None of them had a test
  that started in padding, because the padding press had always been the browser's.
