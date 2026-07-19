# Feature: Fork-A Spike — Reserved-child-0 Chrome Structural Ops + Paste

The `:::note` callout reserves child index 0 as an editable `note-title` chrome
leaf. This gate characterizes the reserved-index structural ops (merge, Backspace,
Enter, typing) and the paste-into-title path. Behavioral gate: CST/selection read
by path via `window.__test`, not visuals.

## Gate 2 — reserved-index-0 structural ops (correct or characterized)

- merge walk: Backspace at the start of the block AFTER the callout merges into the last BODY child, never the title
- first body-child Backspace: at the start of child 1, the not-mergeable title refuses the merge; focus moves to the title, the tree is unchanged (body prose never enters chrome)
- title Backspace-at-start: a safe no-op (the lift strategy is blockquote-hardcoded and declines for the callout)
- Enter-in-title: descends into the first body child at offset 0 — the chrome never splits, the document and raw are untouched
- Enter-in-title with a title-only callout: mints an empty body paragraph, focuses it, and typing lands in it
- descend undo-cleanliness: descend onto an existing body commits nothing — a single Ctrl+Z afterwards reverts the edit made BEFORE the descend
- typing-in-title: keeps the `note-title` kind (contextDependentKind); the typed title re-renders in the opener line
- windowing: the reserved chrome row keeps BlockListState ids/refs in lockstep across edits

## Gate 5 — paste into the title (must pass)

The chrome leaf is single-line by serialization, so any paste whose target is the
reserved chrome is forced inline ahead of the container-paste family: the clipboard
flattens to one line spliced at the caret, the chrome stays a single node, and the
container family never fires.

- multi-block clipboard: pasting a two-paragraph clipboard into the title splices its text inline at the caret with the paragraph break collapsed to a single space — the chrome stays one note-title node (never splits into paragraphs) and the container-paste family never fires
- CRLF paragraph break: a Windows clipboard's `\r\n\r\n` break collapses to a single space, not two — each run flattens once, so the pasted title carries no doubled whitespace

## User interactions

- Backspace, Enter, typing, Ctrl+V, Ctrl+Z are real gestures; assertions read the CST/selection by path, never the DOM shape
