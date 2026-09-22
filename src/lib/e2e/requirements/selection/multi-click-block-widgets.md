# Feature: the block level on a paragraph full of inline widgets

Triple-click a paragraph carrying rendered formulas and the whole paragraph stays selected.
The block-level handler paints a range over the block's whole content, and nothing that runs
after the click may put a caret over it: the widget edge-snap
(`components/blocks/text/widget-interaction.ts`) runs on every click, and a caret it placed
there would collapse the range the user just made.

## Happy paths

- triple-click a widget-dense paragraph, in source and live mode: the whole paragraph is
  selected, from its first word to its last, and it is still selected a moment later
  - Miss-analysis: the block-level handler's spec runs on the plain harness, where no plugin
    mounts a widget, and the plugins page's priority-order spec covers only the word-level
    handler, so a triple-click on a paragraph holding a widget was never on screen in a spec
- triple-click a paragraph whose only widget sits at its start: the range reaches the last
  word and opens before the formula
- triple-click the rendered formula itself, in source and live mode: the whole paragraph is
  selected and stays selected. A third click belongs to the block, not to the widget under it:
  the widget's own gesture ends at the second click, so the third neither shows a source nor
  takes the token again, and the shown source stays open under a range that holds it rather
  than rebuilding the block and cutting the range short
  - Miss-analysis: every scenario here pressed on prose beside a widget, and the two gestures
    that can fight over a click only meet when the press lands on the widget itself
