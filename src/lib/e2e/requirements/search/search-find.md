# Feature: Find — highlight, navigate, and reveal

Scanning the live document for a query: painting one highlight per match,
navigating between them, re-scanning as the document changes, and revealing an
off-window match.

## Happy paths

- Typing a query paints one `.match-overlay` per match and the count reads `1 / N`; exactly one overlay is `.match-overlay-active`.
- Enter advances to the next match; the active index in the count readout increments.
- Shift+Enter steps to the previous match; the active index decrements.

## Edge cases

- Enter on the last match wraps the active index back to the first.
- Shift+Enter on the first match wraps to the last.
- A regex that can match empty (e.g. `a*`) paints no zero-width overlay sliver — every painted `.match-overlay` has nonzero width.
- In a tall windowed document, navigating to an off-window match scrolls its block into view and mounts it.

## User interactions

- Editing the document while the bar is open re-scans and updates the count.
