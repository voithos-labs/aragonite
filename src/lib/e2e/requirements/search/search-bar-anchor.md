# Feature: Find/replace bar in a consumer-supplied anchor

`searchBarAnchor` hands the editor-owned bar a home outside the editor root, for host-scroll
embeds where the default sticky anchor scrolls away with the document. Everything else stays
the editor's: the component, the Ctrl+F / Ctrl+H chords, Escape, and the pre-search caret
restore.

## Happy paths

- With an anchor supplied, Ctrl+F renders the bar inside the anchor element and nowhere inside
  the editor root; the find input still auto-focuses.
- Typing a query into the anchored bar paints the match highlights over the document.
- Ctrl+H opens the anchored bar with the replace row already expanded.

## Edge cases

- Theme tokens resolve inside the anchor: the bar computes to the token value, not to the
  component's inline fallback, even though the anchor sits outside every theme scope.
- Flipping the `theme` prop while the bar is anchored re-resolves those tokens live.
- Dropping the anchor mid-session returns the bar to the editor root with the bar still open
  and its query intact; re-supplying it moves the bar back.
- With no anchor supplied, the bar renders in the editor root exactly as before.

## User interactions

- Esc from inside the anchored bar closes it and restores the pre-search caret, so the next
  typed character lands where the user left off.
