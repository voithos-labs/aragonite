# Feature: what an inline `$…$` run claims in prose

Inline math recognition is guarded so shell and currency prose keeps its dollar signs. The guard
used to read the byte after the opening `$`, which made every digit-opening formula literal —
`$10^5$` among them. It now reads the span it would claim instead: a run that is only a number is
a price, and a closing `$` a digit follows opens the second price of a range. A directive
container is not part of that decision; its prose reaches the same recognizer a top-level
paragraph does.

## Happy paths

- `$10^5$` inside a `:::tip` body renders as a KaTeX equation, in source mode and in live mode,
  and the directive's bytes are unchanged.
- The same span in a top-level paragraph renders the same way — the container never was the
  discriminator.

## Edge cases

- `$5 and $10` and `$10-$20` in the same directive body stay literal text, with no widget
  anywhere in the document.

## Miss-analysis

- The recognizer's table paired a letter opener with a digit closer (`$x^2$`) and a digit opener
  with no closer (`$5`, `$5 and $10`), never a digit opener WITH a valid closer — the one cell
  the old first-byte guard answered wrongly. No e2e drove a `$…$` run inside a container at all,
  so the report arrived describing the container rather than the guard.

## Error cases

- The `[invariant:…]` console watcher stays silent across both modes.
