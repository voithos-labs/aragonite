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
  selected, and it stays selected as the formula re-renders. A third click belongs to the block,
  not to the widget under it: the widget's own gesture ends at the second click, so the third
  neither shows a source nor takes the token again, and the range it paints comes back over the
  block once the source the first click showed is hidden
  - Miss-analysis: every scenario here pressed on prose beside a widget, and the two gestures
    that can fight over a click only meet when the press lands on the widget itself
- typing over that selection replaces the paragraph, formula and all: what the third click
  painted is a range over the block's content, not a highlight over a block nothing can edit
- triple-click a widget that never shows a source, an entity: the whole paragraph is selected,
  and it stays selected. The first two clicks of the run leave it to the block, so the third is
  the only one that can select anything
  - Miss-analysis: every widget these scenarios pressed on shows its source on the first click,
    which swaps the widget for editable text before the third press arrives, so the rule the
    click order carries for a widget that stays a widget was never on screen
- double-click or triple-click an inline image: the image stays the one selected thing, with no
  range and no caret beside it, and a typed character replaces it. The first click selects the
  image whole and the second opens its crop frame, so the third press lands on the crop frame
  - Miss-analysis: the case read the selected text, which a collapsed caret leaves empty, and
    counted overlays, which reads only the image's side, so the caret the browser seated at the
    paragraph's start on the third press passed both
