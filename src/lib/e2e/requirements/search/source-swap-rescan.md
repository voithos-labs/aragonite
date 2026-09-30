# Feature: an open find bar rescans across a `source` swap

The search source uses the same edit generation counter as any other decoration
source: its scan is cached on `editEpoch + options + query`. A whole-document
`source` swap under an open find bar must therefore re-scan, or the bar keeps the
previous document's count and paints overlays over text that holds no match.

Scenarios run on the default editor harness, driving the swap through
`window.__test.setSource`, the real prop write a consumer performs.

The swap must also discard the navigation position. That counter cannot say so on
its own, since a keystroke bumps it too, so the editor counts replacements
separately and search restarts on that signal alone.

## Happy paths

- swap to a document with a different number of matches: the counter reads the new
  total and one overlay paints per new match
- navigate to the last match, then swap to a document with more matches: the bar
  reads the first match of the new document, not the position carried from the old
  one (the regression reads `3 / 5` on a document never navigated)

## Edge cases

- swap to a document with zero matches while the bar is open: the counter reads
  "No results" and no overlay paints (a stale count with a phantom overlay is the
  regression)
- the find input keeps the query across the swap, so the bar stays usable without
  retyping
