# Feature: a press above or below a picture, inside its own block

A picture sits on the text baseline, so the paragraph holding it is a little taller than the
picture: there is a strip of the block's box above the picture and another below it. The
paragraph's only content is a widget the browser will not put a caret next to, so the click
snap (`cursor/widget-edge-snap.ts`) is the only thing that can place one, and a press in either
strip belongs to the block's one line.

Every scenario holds in source mode and in live mode: hidden markers are not text a caret can
land in either way, so the strip reads the same in both.

## Happy paths

- press in the strip below the picture, right of its middle, then type: the character lands
  immediately after the image source
- press in the strip above the picture, right of its middle, then type: the same
  - Miss-analysis: every click-snap scenario pressed on the picture's own line, left of it or
    right of it, so the vertical half of the snap's containment test was never asked about a
    point that shares the picture's columns but not its line

## Edge cases

- press in the strip below the picture, left of its middle, then type: the character lands
  immediately before the image source, so the strip answers by the side the press is on rather
  than always taking the trailing edge
