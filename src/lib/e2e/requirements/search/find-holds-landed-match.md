# Feature: Find keeps a match where it already sits

Stepping to a match that's already on screen shouldn't move the page, and it shouldn't move later either, when something above the match changes height after the step (an image finishing its download, say).

## Happy paths

- A match sits mid-viewport, a still-loading image sits just above the viewport's top, and Enter in the find bar steps to that match: the page doesn't move, and when the image then loads and grows, the match's top stays within 1px of where it was
  - Miss-analysis: every test of a held scroll target put the target at the viewport's top, where "keep it where it landed" and "put it back at the top" give the same answer, so nothing saw the second one drag a mid-viewport target up.
