# Feature: what an inline `$…$` run claims in prose

Inline math recognition is guarded so shell and currency prose keeps its dollar signs, and the
guard reads the span a run would claim, never the byte after the opening `$` (so `$10^5$` is a
formula). An attempt ends at the next `$`, whichever it is: a closer needs a non-space before it
and no digit after it, a run that fails there stays literal rather than trying a later `$`, and a
run that is only a number is a price. A directive container is not part of that decision; its
prose reaches the same recognizer a top-level paragraph does.

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
