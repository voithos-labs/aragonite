# Feature: a click in a code block's padding lands on its nearest line

A code block's host keeps a strip of room above and below its grey box. A click in that
strip lands the caret on the nearest line of code, at the column under the click,
the same way a click beside a line lands at that line's nearest spot. Where the mode hides
the fence lines, the nearest line is a line of code, never a fence.

## Happy paths

- Click in the strip above the grey box (live, and preview-block with the block unfocused),
  then type: the character lands in the first line of code at the column under the click.
- Click in the strip below the grey box (same modes), then type: the character lands in the
  last line of code at the column under the click.

The grey box's own padding, inside the text element, is `selection/padding-row-point.md`.

## Miss-analysis

- The margin-click tests only ever clicked beside prose, whose text fills its block's box,
  so no test clicked the strip a code block's box keeps around its text, where the point
  sat outside the text and the click was declined.
- The column held only on Windows: the click was pulled into the grey box but not past its
  padding, and Chromium on Mac and Linux answers a point above the first line (or below the
  last) with that line's start (or end). The suite only ever ran on Windows before Linux CI,
  so no run saw the other answer.
