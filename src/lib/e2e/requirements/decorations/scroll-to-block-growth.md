# Feature: a block scrolled into view stays put while images above it load

Every route that brings a block into view leaves it where it landed while the
images above it load and grow from zero height: the growth moves the page, not
the block. The images are local fixture photos held behind a gate the test opens
either mid-scroll (on the first photo the scroll asks for) or once the route has
resolved. The fixture is a capped viewport over 12 paragraphs, 20 photos, the
target and 90 paragraphs after it, so the target starts windowed out.

## Happy paths

- `scrollTo(path, { block: 'nearest' })` to the target, photos loading during the
  scroll or after it resolves: resolves `true`, and once every photo has grown the
  target is still in view. With the photos loading after, it is in view at resolve
  and ends within 2px of where it landed.
- `scrollTo(path, { block: 'center' })`, both release points: the same, and the
  target is still centered (within 30% of the viewport) after the growth.
- `navigateTo(path)`, the call a heading or footnote link makes, from a focused
  editor, both release points: resolves `true`, and the target stays put.
- The search bar's jump to the target's only match, both release points: the
  target stays put.
- Undo landing its caret in the far target (the edit made there, the view scrolled
  back to the top, the caret parked in the first block), both release points: the
  target stays put. Here the caret's block is what each correction keeps still.
- `scrollTo` nearest to an item's paragraph in a list that windows its own items,
  with the photo band in the items above it, both release points: the target
  stays put.

## Edge cases

- A mid-scroll row asserts that the photos began loading before the route
  resolved, so the two release points can't silently be one case.
- A mid-scroll row checks only the settled page: a read between a photo's growth
  and the same frame's correction sees a page no frame paints.
- A picture above the target grows and, in the same task, `scrollTo` nearest or
  `navigateTo` jumps to the target, before the browser has reported the growth:
  once the report arrives, the target is still where it landed, within 2px.

## Miss-analysis

- A size report read between a height write and the render after it was put on
  the wrong block, and a centered `scrollTo` let go of its block at resolve. The
  only image tests held the photos undecoded forever (`scroll-to-settle`), so
  nothing grew above a target once it had landed, and no test ran the routes
  that scroll to a block as one class.
- #798: a search jump while pictures above it were still loading could land the
  view away from the match. A jump read the target off a page whose new picture
  sizes the browser hadn't reported yet, so the height tables lagged the page.
  Every growth row let the browser's own frame order decide whether a report came
  first, which WebKit loses now and then and Chromium almost never; no row put the growth
  ahead of the report on purpose.
- The undo rows timed out on Firefox about one run in three: their setup scrolled
  to the top in the same frame as the keystroke, and the browser's own reveal of
  that keystroke's caret ran after it and scrolled back. `scrollEditorTo` wrote
  as soon as it was called, and no helper test typed and scrolled back to back.
