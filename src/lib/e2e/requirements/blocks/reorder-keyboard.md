# Feature: Keyboard block reorder (Alt+ArrowUp / Alt+ArrowDown)

Alt+ArrowUp / Alt+ArrowDown moves the focused reorder unit one position among
its siblings. The unit follows from the caret's path: a top-level block at the
document level, a list **item** (not its inner paragraph) under a list, a
blockquote child under a blockquote. The move is one undo step, the caret
follows the moved unit, and the node keeps its identity across the move.

The chord must not move the caret (it is not arrow navigation) and must work
whether or not the drag handles are turned on.

## Happy paths

- Alt+ArrowDown on a top-level block moves it below its next sibling; focus
  follows, so the next typed character lands in the moved block.
- Alt+ArrowUp on a list item at index >= 2 moves the item (not its paragraph)
  up one position among the list's items.
- Alt+ArrowDown on the first list item moves it down one position.
- Alt+ArrowDown on item 9 of a ten-item ordered list, and Alt+ArrowUp on item 10, renumber the
  moved item between `9. ` and `10. `; the next typed character lands right after the new marker.
- Alt+ArrowUp on a blockquote child moves it up among the blockquote's children.
- Alt+ArrowDown on a focused fenced code block moves the whole block below its
  next sibling; a single undo restores the source as it was before the move.
- Alt+ArrowUp on a focused thematic break moves it above its previous sibling.

## Edge cases

- A single undo after a reorder restores the source exactly as it was before the move.
- Alt+ArrowUp on the first sibling does nothing (it is clamped: no move, no error, no undo
  entry).

## Pinned below the browser

These moves run without a page, through the reorder action or the tree operation under it:

- A move that would leave a divider flush under a paragraph writes a blank line between them, so
  the rule doesn't read as the paragraph's setext underline
  (`test/tree-operations/reorder-lands-whole.property.test.ts`,
  `test/tree-operations/reorder-vacated-join.test.ts`).
- A paragraph moved up out from under an HTML block leaves a blank line before the quote below, so
  the quote and the list after it don't reload as HTML text
  (`test/editor-actions/reorder-seam-undo.test.ts`,
  `test/tree-operations/reorder-blank-line-ended.test.ts`).
- A heading moved up from between a paragraph and a table flush under it leaves a blank line before
  the table, so the table stays a table (`test/editor-actions/reorder-seam-undo.test.ts`,
  `test/tree-operations/reorder-vacated-join.test.ts`).
- Inside a quote, the same two moves leave a blank quote line, so the nested quote stays a quote
  and the table stays a table (`test/editor-actions/reorder-in-container.test.ts`).
- In a document with no final line break, in LF and in CRLF, Alt+ArrowUp on the last block and
  Alt+ArrowDown on the block above it keep the two blocks on lines of their own: the block that
  gains a follower ends its line in the document's line ending, and the block that becomes last
  gives up its ending (`test/editor-actions/reorder-unterminated-tail.test.ts`).
- A move down from the last sibling does nothing. Every container shares one clamp, and
  `test/editor-actions/reorder-action.test.ts` runs it on the last item of a list.

## User interactions

- A real keyboard chord (`Alt+ArrowUp` / `Alt+ArrowDown`) on a focused block.
- Plain ArrowUp/ArrowDown still navigate the caret across block boundaries;
  the Alt modifier is what chooses reorder over navigation.
