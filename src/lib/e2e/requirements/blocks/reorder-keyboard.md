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
- Alt+ArrowUp on a blockquote child moves it up among the blockquote's children.
- Alt+ArrowDown on a focused fenced code block moves the whole block below its
  next sibling; a single undo restores the source as it was before the move.
- Alt+ArrowUp on a focused thematic break moves it above its previous sibling.
- A divider moved into a gap whose neighbours had no blank line between them (a heading
  interrupting the paragraph above it) arrives with one: the paragraph stays a paragraph
  rather than reading the rule as its setext underline, and the source reloads to the same
  three blocks.

## Edge cases

- A single undo after a reorder restores the source exactly as it was before the move.
- Alt+ArrowUp on the first sibling / Alt+ArrowDown on the last does nothing
  (it is clamped: no move, no error).

## User interactions

- A real keyboard chord (`Alt+ArrowUp` / `Alt+ArrowDown`) on a focused block.
- Plain ArrowUp/ArrowDown still navigate the caret across block boundaries;
  the Alt modifier is what chooses reorder over navigation.
