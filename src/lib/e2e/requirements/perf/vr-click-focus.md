# Feature: a click into a block keeps the page where it was

A click into a block puts the caret there, and sometimes swaps what the block shows for something taller: a display formula shows its source, an inline formula opens its source in the line. Either way the page shouldn't move. Whatever you clicked stays under the pointer.

Two bits of code hold that up, both from the fix for click-focus jumps (270c2839c):

- The click routes in `src/lib/components/blocks/text/widget-interaction.ts` focus the block's own element with a plain `focus()`: when a click opens a formula's source, when an arrow key enters a formula at the block's edge, and when a click beside a formula snaps the caret to it. The block is already on screen by then, so the browser's own focus scroll has nothing to do. A route that focused something off screen would scroll the page by itself, and this spec would catch it.
- When heights change around the click, the height correction keeps the focused block still, as long as its top is at or below the top of the viewport (`src/lib/windowing/pinned-block.ts :: heldBlock`, which every correction a list makes picks through), instead of the block at the top. It only matters when something above the clicked block changes height too, like an open formula above it closing as the click lands; otherwise holding either block gives the same answer.

The fixture is the `/test/plugins` route, which has the LaTeX plugin on, with 30 short paragraphs above and below the three targets. The display formula renders on one line but has six lines of source, so opening it makes the block a lot taller.

## User interactions

- Click into the middle of a paragraph that sits mid-viewport: `scrollTop` doesn't move (1px tolerance).
- Click on a display formula: its source shows, taller than the render, and `scrollTop` doesn't move (1px tolerance).
- Click on an inline formula: its source opens in the line, and `scrollTop` doesn't move (1px tolerance).
- With the display formula's source open, click on the inline formula in the line below it: the display formula closes and shrinks as the inline one opens, and the clicked line stays under the pointer (its top moves under 1px). Holding the top block here instead slides the line up by the shrink, over 100px.

## Non-vacuity

- The document has to be taller than the editor, and each case scrolls its target to the middle first and checks `scrollTop` is past zero. A page held still at the very top proves nothing.
