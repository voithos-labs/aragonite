# Perf: the drawn caret lands in the letter's frame

The editor draws its own caret on a fine pointer, so a slow or late paint would be a caret the
user sees a frame behind the letter. A probe samples every frame just before it paints and
compares the drawn bar with the browser's live range. Every key and click waits for the frame it
paints in, so every move is sampled at a frame boundary. Run under `npm run perf:e2e` and the
`npm run perf:check` gate.

## Happy paths

- Row A, typing in a 1MB prose document (source and live) and in a 1MB nested-containers document's list item (live), 30 keys mid-word, 30 at the block's end, and five Enter and Backspace pairs: no frame shows the drawn caret more than a pixel from the range
- Row B, the same run: the largest difference between the drawn box and the range's box (x, y or height) is at most a pixel
- Row A's run also counts the frame paints that moved the bar, and holds it at zero: every typed key, Enter and Backspace writes the caret, and a write's own repaint request moves the bar before the frame, so a frame that finds the bar still to move is a write that didn't ask
  - Miss-analysis: the lagging-frame count can't see a dropped repaint request, since the frame paint repairs the bar before the frame renders; only the writer's unit row did
- Row C, moves the browser makes on its own (ArrowRight and ArrowLeft runs, ArrowDown within a block, clicks): lagging frames per move stay at or under the blessed count

## Reported, not gated

- `caretPaintMs`, from the first repaint request of a task to the paint's end (the Svelte flush and the height measure the request waits for included), p50 and p95
- Event Timing's `keydown` to next paint p50, over the entries it reports (16ms and up), for an A/B against the build before the drawn caret
