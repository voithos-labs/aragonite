# Feature: an open find bar rescans across a `source` swap

The search source rides the same edit epoch as any other decoration source: its
scan is memoized on `editEpoch + options + query`. A whole-document `source` swap
under an open find bar must therefore re-scan, or the bar keeps the previous
document's count and paints overlays over text that holds no match.

Scenarios run on the default editor harness, driving the swap through
`window.__test.setSource` — the real prop write a consumer performs.

The swap must also discard the navigation position. The edit epoch cannot express
that on its own — a keystroke bumps it too — so the editor counts replacements
separately and search restarts on that signal alone.

## Happy paths

- swap to a document with a different number of matches: the counter reads the new
  total and one overlay paints per new match
- navigate to the last match, then swap to a document with MORE matches: the bar
  reads the first match of the new document, not the position carried from the old
  one (the regression reads `3 / 5` on a document never navigated)

## Edge cases

- swap to a document with ZERO matches while the bar is open: the counter reads
  "No results" and no overlay paints (a stale count with a phantom overlay is the
  regression)
- the find input keeps the query across the swap, so the bar stays usable without
  retyping
