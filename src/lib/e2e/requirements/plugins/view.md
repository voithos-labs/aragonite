# Feature: where the document sits on screen (`editor.view`)

`editor.view` answers in document bytes and viewport rects: a block's box, a range's boxes, the caret's box, the byte under a point, a scroll that brings a block into view, and an element pinned over a block. The spec drives it through the bridge's `view` probe, which holds the block and the overlay a spec names. The answers that aren't geometry are unit rows in `test/plugins/read/view.svelte.test.ts`.

## Happy paths

- The byte at the caret's box: after a click in a paragraph, `posAt` at the caret's box answers the selection's own byte, and the selection neither moves nor announces itself
- A range across blocks: `boxesOf` over a paragraph, two list items and another paragraph has a box on each of their lines
- `reveal` of a byte far down a long document mounts its block and brings it on screen; `align: 'center'` puts it near the middle, `align: 'start'` at the top
- An overlay sits at its block's top-left corner, stays there through a wheel scroll, hides while the block is windowed out, and comes back to it on the way back

## Edge cases

- A held block after the first key typed inside it: `reveal` resolves false and its overlay comes off, while the block read again reveals
- Typing in an input inside an overlay: the input keeps every key, Backspace and Enter included, and the document doesn't change
- The blocks above change size with no write: a block above grows taller with no node mounted (a picture finishing its load), then the editor narrows with the window as it was, and the overlay stays on its block both times. Miss-analysis: every overlay row moved the block by a key, a scroll or windowing, the three things the overlay listened for; none moved it by layout alone, so it stayed 120 px off after the growth and 325 px off after the narrowing.
