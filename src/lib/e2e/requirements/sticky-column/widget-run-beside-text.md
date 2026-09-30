# Feature: Sticky column into a line that holds widgets and text

A paragraph that opens on a run of entity widgets and continues in ordinary text puts both on one
visual line. Every boundary between two widgets is a position the caret can take and the browser
draws nothing at, and the text beside them is where a caret shows. A vertical arrival has to pick
the text even when a widget edge sits nearer the column.

## Happy paths

- ArrowDown into the line from the start of the paragraph above: the caret lands at the start of
  the text, and a typed character appears after the last entity rather than before the first
  - Miss-analysis: the specs that arrive into a widget hold nothing but widgets, so every
    position in the block was a widget edge and the rule that prefers one the browser paints had
    nothing to prefer it over; the image spec that states the rule holds an image, which takes a
    visual line of its own, so its widget edge is never on the line the arrival reads
- ArrowUp into the line from the start of the paragraph below: the same landing, so the rule does
  not depend on which edge line the arrival reads
