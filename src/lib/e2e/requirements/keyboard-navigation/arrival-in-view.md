# Feature: Keyboard Navigation, a Caret That Ends Up Off Screen Comes Into View

When a key puts the caret somewhere that isn't fully on screen, the editor scrolls just far enough to show it: the caret's line in a paragraph, the whole cell in a table, the whole block for a divider. Something peeking a sliver over the edge counts as off screen, and a caret already fully on screen doesn't move the page. The editor does that scroll itself; the focus call that puts the caret down never scrolls on its own.

## Happy paths

- ArrowDown from the last line on screen onto a divider just below the viewport: the divider ends up with its bottom at the viewport's bottom edge (within 2px)
  - Miss-analysis: every arrow test ran in a document that fit on screen, so the browser's own focus scroll (which centres) never had to move anything, and nothing noticed it was the one doing the scrolling.
- ArrowDown from the last line on screen onto a paragraph just below the viewport: the caret's line comes on screen
  - Miss-analysis: text arrivals focus without scrolling so a click never jumps the page, and no test ever arrowed onto a paragraph that sat off screen, so the caret quietly vanished below the edge until you typed.
- ArrowDown onto a table just below the viewport: the cell the caret went to comes fully on screen
- ArrowDown from a table row onto the next row just below the viewport: that row's cell comes fully on screen
  - Miss-analysis: a cell move goes through the table's own focus, which never scrolls, and every table test fit on screen.
- Walking down a 40-row table with ArrowDown: after every press the caret sits inside the viewport
  - Miss-analysis: "in view" meant any overlap, so a cell peeking a sub-pixel sliver over the edge read as shown and the scroll was skipped on every other press; the one table row test stepped a single row.
- ArrowUp onto a paragraph whose bottom peeks 2px under the top edge: its last line comes on screen
- ArrowDown onto a paragraph taller than the viewport: the caret's first line comes on screen and the page moves by about a line, not a screen
  - Miss-analysis: every arrival test landed on a block shorter than the viewport, where showing the block and showing the caret's line are the same scroll.
- Alt+ArrowDown on a divider sitting just above the bottom edge moves it past a tall paragraph and off the screen: it comes back to the bottom edge (within 2px), and the focus call scrolls nothing along the way (the `landing-focus-scrolls-nothing` check stays quiet)
  - Miss-analysis: reorder-in-view moves paragraphs, whose focus never scrolled, so no test moved a block focused whole, the one kind whose focus call did.
- Select All (twice, so it takes the whole document), then ArrowRight in a document taller than the editor: the caret collapses to the end, and the last block is on screen
  - Miss-analysis: the collapse only mounted the end block and trusted the focus call to show it, which didn't happen once the block had to mount first, and no test collapsed a range in a document taller than the editor.
