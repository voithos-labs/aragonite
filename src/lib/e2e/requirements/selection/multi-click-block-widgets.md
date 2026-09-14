# Feature: the block rung on a paragraph full of inline widgets

Triple-click a paragraph carrying rendered formulas and the whole paragraph stays selected.
The rung paints a range over the surface's content whole, and nothing that runs after the
press may seat a caret over it: the widget edge-snap (`components/blocks/text/widget-interaction.ts`)
runs on the click of every press, and a caret it seats there would collapse the range the
user just made.

## Happy paths

- triple-click a widget-dense paragraph, in source and live mode: the whole paragraph is
  selected, from its first word to its last, and it is still selected a moment later
  - Miss-analysis: the block rung's spec runs on the plain harness, where no plugin mounts a
    widget, and the plugins page's ladder spec covers only the word rung, so a triple-click
    on a paragraph holding a widget was never on screen in a spec
- triple-click a paragraph whose only widget sits at its start: the range reaches the last
  word and opens before the formula
