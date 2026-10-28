# Feature: Blocks drawn by a DOM view

A plugin block drawn by `defineBlockView` puts its own DOM into an element the editor makes for
it. A leaf view hands the editor the element whose text it edits; a container view hands it the
box its child blocks mount into; a hand-built view draws everything and says how it takes focus.
The harness seed `dom-view` has one of each: an `@@ ` memo with a badge drawn before its text, a
`[[dom-badge]]` block, and a `:::dombox` container.

## Happy paths

- Typing at the end of the memo writes the character into the memo's line and nothing of its
  badge; Ctrl+Z (Cmd+Z on a Mac) takes the character back out
- Typing three characters at the end of a dombox child writes them into the child, and the box's
  view gets exactly one update per character, with nothing on the console

## Edge cases

- A selection swept from the first paragraph to the end of the document paints the badge block
  with one box over exactly the element its view drew into, edge for edge
- In a document long enough to window, scrolling the badge block out of the rendered range
  destroys its view once, and scrolling back mounts it again
- A dombox holding 400 paragraphs mounts only the children near the viewport, with a spacer for
  the rest inside its own box; scrolling to the end mounts the last child and unmounts the first

## User interactions

- ArrowDown from column 10 of a paragraph onto the badge, ArrowRight out to the start of the
  paragraph below, then ArrowDown: the caret lands at the start of the next paragraph, not back at
  column 10, since a sideways exit ends the column the vertical run kept. Miss-analysis: the
  arrow exit a hand-built block shares with a plugin container's `moveFocusOut` tells the caret
  memory which key left, and no row pressed a second arrow after the exit, so dropping that line
  kept every suite green.
