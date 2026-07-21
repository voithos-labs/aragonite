# Feature: Find/replace bar — open, close, and toggles

Opening and dismissing the find/replace bar, and the match-set toggles (case,
whole-word, regex) that narrow or reinterpret the query.

## Happy paths

- Ctrl+F opens the bar and focuses the find input.
- Ctrl+H opens the bar with the replace row already expanded.

## Edge cases

- Ctrl+F / Ctrl+H still open the bar when CapsLock uppercases the key (no Shift modifier).
- The case toggle (`Aa`) narrows a case-insensitive match set to the case-sensitive subset (count drops).
- The whole-word toggle (`W`) drops substring-only matches (count drops).
- The regex toggle (`.*`) interprets the query as a pattern (a metacharacter query matches where a literal one would not).
- Reopening the bar after Esc with an unchanged query (no edits between) re-scans and re-paints the highlights — a stale scan memo must not serve the closed bar's cleared matches.

## Error cases

- An invalid regex (e.g. `(`) shows an error readout instead of a count, paints no highlights, and does not crash.
- Esc closes the bar, removes all highlights, and returns focus to the document.
