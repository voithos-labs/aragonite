# Feature: In-document find and replace

The find/replace bar searches the live document, paints match highlights over the
mounted blocks, navigates between matches, and rewrites matched text — driven
entirely through the keyboard and the bar's buttons. Replace-all is one undo step.

## Happy paths

- Ctrl+F opens the bar and focuses the find input.
- Typing a query paints one `.match-overlay` per match and the count reads `1 / N`; exactly one overlay is `.match-overlay-active`.
- Enter advances to the next match; the active index in the count readout increments.
- Shift+Enter steps to the previous match; the active index decrements.
- Replace rewrites the active match, advances, and leaves the rest intact.
- Replace All rewrites every match in one pass.
- Ctrl+H opens the bar with the replace row already expanded.

## Edge cases

- Ctrl+F / Ctrl+H still open the bar when CapsLock uppercases the key (no Shift modifier).
- Enter on the last match wraps the active index back to the first.
- Shift+Enter on the first match wraps to the last.
- The case toggle (`Aa`) narrows a case-insensitive match set to the case-sensitive subset (count drops).
- The whole-word toggle (`W`) drops substring-only matches (count drops).
- The regex toggle (`.*`) interprets the query as a pattern (a metacharacter query matches where a literal one would not).
- A regex that can match empty (e.g. `a*`) paints no zero-width overlay sliver — every painted `.match-overlay` has nonzero width.
- A regex `$1` capture reference expands in the replacement.
- A replacement that introduces a heading marker changes the block's kind.
- A regex-mode replacement with a `\n` escape splits the matched block into two (the single-line replace input can't carry a real newline).
- Replace All is a single undo: one Ctrl+Z restores the entire original document.
- In a tall windowed document, navigating to an off-window match scrolls its block into view and mounts it.
- Reopening the bar after Esc with an unchanged query (no edits between) re-scans and re-paints the highlights — a stale scan memo must not serve the closed bar's cleared matches.

## User interactions

- Find counts matches inside table cells; the matching cells highlight.
- Replace All fixes the text inside every matching table cell.
- Single Replace on a table-cell match rewrites only that cell.
- Editing the document while the bar is open re-scans and updates the count.

## Error cases

- An invalid regex (e.g. `(`) shows an error readout instead of a count, paints no highlights, and does not crash.
- Esc closes the bar, removes all highlights, and returns focus to the document.
