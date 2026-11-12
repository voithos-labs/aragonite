# Feature: the gap caret a removal holds

Remove a range and sometimes nothing is left to type into: the last paragraphs under a code
block are gone, and the next byte is the closing fence. The caret then rests in the gap where the
text was, a boundary no arrow key stops at. This file covers that gap in a real browser: the bar,
the next key, undo, the modes and a windowed document. Which boundaries hold it, route by route
and kind by kind, is the unit suite's (`test/range-laws/held-gap.test.ts`). The gap an arrow
reaches is in `gap-caret-arrival.md`, `gap-caret-editing.md` and `gap-caret-surface.md`.

## Happy paths

- Backspace, Delete or a cut over the last two paragraphs, the first tight under a code block:
  the paragraphs go, one bar draws under the code block with no browser caret beside it, and the
  gap is marked held. A letter then opens a paragraph there and the code block keeps its bytes.
- Enter over the same range opens an empty paragraph where the range was, with the caret in it,
  so the next letter lands there. The code block keeps its bytes.
- Undo after a letter typed at the bar takes the letter back and returns the bar. A second undo
  returns the paragraphs. Redo removes them again and holds the bar again.

## Edge cases

- A switch between source and live keeps the bar where it is. Reading mode ends it, as it ends
  any gap caret.
- At the end of a document long enough to be windowed, the bar draws in view while the top of the
  document is unmounted. Scrolling to the top unmounts the bar and keeps the gap; scrolling back
  draws it again. The letter typed then lands under the code block and the page doesn't move.

## User interactions

- The range is a click and a shift-click, the keys are real keys, undo is Mod+Z. In the windowed
  row the first caret is placed through the test bridge, since a click can't reach an unmounted
  block.

## Miss-analysis

- The held gap arrived with rows in jsdom only, which mounts every block and draws no bar: no row
  could tell whether a browser draws it, keeps it through a scroll, or sends the next key to it.
- Enter over the range ran its command in the code block at the gap's byte, which held no caret,
  and wrote a line into the code. Every row pressed a removal key or a letter, never a command key.
