# Feature: a click in a code block's padding lands on its nearest line

A code block sits in a box with some room above its first line and below its last. A click
in that room lands the caret on the nearest line of code, at the column under the click,
the same way a click beside a line lands at that line's nearest spot. Where the mode hides
the fence lines, the nearest line is a line of code, never a fence.

## Happy paths

- Click in the room above the first line (live, and preview-block with the block unfocused),
  then type: the character lands in the first line of code at the column under the click.
- Click in the room below the last line (same modes), then type: the character lands in the
  last line of code at the column under the click.

## Miss-analysis

- The margin-click tests only ever clicked beside prose, whose text fills its block's box,
  so no test clicked the strip a code block's box keeps around its text, where the point
  sat outside the text and the click was declined.
