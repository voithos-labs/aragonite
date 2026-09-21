# Feature: what an inline `$…$` run claims in prose

Inline math recognition is checked so that shell and currency prose keeps its dollar signs, and
that check reads the whole span a run would take, never the byte after the opening `$`, which is
why `$10^5$` is a formula. An attempt ends at the next `$`, whichever one that is: a closer needs
a non-space before it and no digit after it, a run that fails there stays literal rather than
looking for a later `$`, and a run that is only a number is a price. A directive container plays
no part in that decision: its prose reaches the same recognizer a top-level paragraph does.

## Happy paths

- `$10^5$` inside a `:::tip` body renders as a KaTeX equation, in source mode and in live mode,
  and the directive's bytes are unchanged.
- The same span in a top-level paragraph renders the same way, since the container was never
  what decided it.

## Edge cases

- `$5 and $10` and `$10-$20` in the same directive body stay literal text, with no widget
  anywhere in the document.

## Miss-analysis

- The recognizer's table paired a letter opener with a digit closer (`$x^2$`) and a digit opener
  with no closer (`$5`, `$5 and $10`), but never a digit opener with a valid closer, which is
  the one case the old check on the first byte answered wrongly. No e2e test drove a `$…$` run
  inside a container at all, so the report came in describing the container rather than the
  check.

## Error cases

- The `[invariant:…]` console watcher stays silent in both modes.
