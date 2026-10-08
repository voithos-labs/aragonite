# Perf: the drawn caret lands in the letter's frame

The editor draws its own caret on a fine pointer, so a slow or late paint would be a caret the
user sees a frame behind the letter. A probe samples every frame just before it paints and
compares the drawn bar with the browser's live range. Run under `npm run perf:e2e` and the
`npm run perf:check` gate.

## Happy paths

- Row A, typing in a 1MB prose document (source and live) and in a 1MB nested-containers document's list item (live), 30 keys mid-word, 30 at the block's end, and five Enter and Backspace pairs: no frame shows the drawn caret more than a pixel from the range
- Row B, the same run: the largest difference between the drawn box and the range's box (x, y or height) is at most a pixel
- Row C, moves the browser makes on its own (ArrowRight and ArrowLeft runs, ArrowDown within a block, clicks): lagging frames per move stay at or under the blessed count

## Reported, not gated

- The drawn caret's paint time, from the first request to the paint's end, p50 and p95
- Event Timing's `keydown` to next paint p50, over the entries it reports (16ms and up), for an A/B against the build before the drawn caret
