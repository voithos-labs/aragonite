# Feature: a touch press leaves scrolling and native selection to the browser

On a touch screen a moved finger scrolls and a long press selects with the browser's own handles,
so a touch press never starts the editor's drag-select. A range the press lands on stays through a
scroll and clears only when the press turns out to be a tap. Chromium only: the swipe is CDP
touch events. The real-device rows are in `requirements/mobile/android.md`.

## Happy paths

- A swipe after a tap keeps the caret: a tap puts the caret at the end of the first paragraph,
  and a swipe up that starts on the second paragraph's text leaves it there, collapsed.
  - Miss-analysis: no test exercised touch at all, because nothing read `pointerType`.
- A swipe keeps a range across blocks: a swipe that starts on a paragraph below a range across
  the first two leaves the range exactly as it was.

## User interactions

- A tap clears a range across blocks: a tap at the end of a paragraph below the range puts a
  collapsed caret there. The tap stays clear of the range's formatting toolbar, which takes a tap
  as a command.
