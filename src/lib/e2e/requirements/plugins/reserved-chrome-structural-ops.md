# Feature: Reserved-child-0 title row, structural ops + paste

The `:::callout` callout reserves child index 0 as an editable `callout-title` leaf. This file
records what the structural operations do at that reserved index (merge, Backspace, Enter,
typing) and what a paste into the title does. The checks read behavior: the tree and the
selection read by path through `window.__test`, not visuals.

## Gate 2: reserved-index-0 structural ops (correct or characterized)

- the merge walk: Backspace at the start of the block after the callout merges into the last body child, never into the title
- Backspace in the first body child: at the start of child 1 the title refuses to merge, focus moves to the title and the tree is unchanged, so body prose never enters the title
- Backspace at the start of the title: nothing happens, by declaration. The callout's `keep-reserved-chrome` strategy says child 0 is the title, so nothing lifts it out
- Enter in the title: the caret moves into the first body child at offset 0, the title never splits, and the document and its raw text are untouched
- Enter in the title of a callout that has only a title: an empty body paragraph is created and focused, and typing lands in it
- moving into the body commits nothing: descending onto an existing body writes nothing, so a single Ctrl+Z afterwards takes back the edit made before it
- typing in the title: the child keeps its `callout-title` kind, through `contextDependentKind`, and the typed title re-renders in the opener line
- windowing: the reserved title row keeps the `BlockListState` ids and references in step with the children across edits

## Gate 5: paste into the title (must pass)

The title leaf is a single line once serialized, so any paste aimed at it is forced inline
before the container paste family gets a chance: the clipboard is flattened to one line and
spliced in at the caret, the title stays one node, and the container family never fires.

- a clipboard of several blocks: pasting a two-paragraph clipboard into the title splices its text in at the caret with the paragraph break collapsed to a single space, so the title stays one `callout-title` node rather than splitting into paragraphs, and the container paste family never fires
- a CRLF paragraph break: a Windows clipboard's `\r\n\r\n` break collapses to one space rather than two, because each run is flattened once, so the pasted title carries no doubled whitespace

## User interactions

- Backspace, Enter, typing, Ctrl+V and Ctrl+Z are real gestures; the assertions read the tree and the selection by path, never the shape of the DOM
