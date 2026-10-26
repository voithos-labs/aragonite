# Feature: Find/replace bar, open, close, and toggles

Opening and dismissing the find/replace bar, and the match-set toggles (case,
whole-word, regex) that narrow or reinterpret the query.

## Happy paths

- Ctrl+F opens the bar and focuses the find input.
- Ctrl+H opens the bar with the replace row already expanded.
- The readout is a polite status that sits, empty, in the accessibility tree from the moment the
  bar opens, so a screen reader hears the first count as well as the ones after it.
  Miss-analysis: no test asked what a screen reader hears from the bar, and the readout had no
  live role at all.

## Edge cases

- Ctrl+F / Ctrl+H still open the bar when CapsLock uppercases the key (no Shift modifier).
- The Match case toggle narrows a case-insensitive match set to the case-sensitive subset (count drops).
- The Whole word toggle drops substring-only matches (count drops).
- The Regex toggle interprets the query as a pattern (a metacharacter query matches where a literal one would not).
- Reopening the bar after Esc with an unchanged query (no edits between) re-scans and re-paints the highlights: a cached scan must not serve the closed bar's cleared matches.
- Under forced colors the focused bar's edge and a pressed toggle paint in the system highlight,
  hovered or not. Miss-analysis: the bar draws its focus ring with a shadow and a pressed toggle
  with a fill, which forced colors drop, and no test opened the bar with forced colors on.

## Closing returns to the caret

- Caret in a line mid-document, find a match far below it, Enter to go there, then Esc: the view
  comes back so the caret's line is on screen (at the nearest edge), and a typed `x` lands right
  where the caret was before the search. Miss-analysis: the Esc test used a two-line document, so
  nothing checked that the return scroll still happens once the focus call stops scrolling on
  its own.
- The same with the match so far away that the caret's block leaves the window entirely: Esc
  still brings the line back and a typed `x` lands at its end. Miss-analysis: the saved caret was
  a DOM range, so once its block unmounted there was nothing to put back, focus fell to the page
  and the next key went nowhere; no test searched far enough to unmount it.

## Error cases

- An invalid regex (e.g. `(`) shows an error readout instead of a count, paints no highlights, and does not crash.
- A valid regex finds its matches while the page's requests go through a route (the e2e fixture's
  off-host guard). Miss: the regex worker's blob URL was revoked right after `new Worker`, and
  WebKit fetches a routed worker script later, so every regex scan failed; nothing ran a regex
  search under a route on WebKit until the guard put one on every spec.
- Esc closes the bar, removes all highlights, and returns focus to the document.
