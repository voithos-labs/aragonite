# Feature: the block rung on a paragraph full of inline widgets

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
