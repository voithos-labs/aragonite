# Feature: clicking beside a run of adjacent atomic widgets

An atomic inline widget (an emoji glyph, a decoded entity, an image) holds no caret position of
its own, so a click beside one snaps the caret to the widget's raw edge. When several widgets sit
flush against each other, the point is beside exactly one of them, and the snap must take the edge
nearest the point rather than the first widget the point happens to be past.

Miss-analysis: every click-snap test ran against a block holding one widget, where "the first
widget the point is past" and "the widget nearest the point" are the same answer, so no test could
tell the two rules apart.

## Happy paths

- Click past the last of four flush glyph widgets: the caret lands after the last widget's bytes,
  so a typed character lands at the end of the line.
- Click past a lone widget on the line: the caret lands after that widget's bytes (the
  nearest-edge rule does not change this).

## User interactions

- The same click in live mode, where the markers are hidden: same landing, since hiding markers
  changes no offset in the DOM-to-offset traversal.
