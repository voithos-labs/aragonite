# Feature: Keyboard block reorder (Alt+ArrowUp / Alt+ArrowDown)

Alt+ArrowUp / Alt+ArrowDown moves the focused reorder unit one slot among its
siblings. The unit is resolved from the caret path: a top-level block at the
document level, a list **item** (not its inner paragraph) under a list, a
blockquote child under a blockquote. The move is one undo step, the caret
follows the moved unit, and node identity is preserved across the move.

The chord must not move the caret (it is not arrow navigation) and must work
regardless of the drag-handle toggle.

## Happy paths

- Alt+ArrowDown on a top-level block moves it below its next sibling; focus
  follows, so the next typed character lands in the moved block.
- Alt+ArrowUp on a list item at index >= 2 moves the item (not its paragraph)
  up one position among the list's items.
- Alt+ArrowDown on the first list item moves it down one position.
- Alt+ArrowUp on a blockquote child moves it up among the blockquote's children.
- Alt+ArrowDown on a focused fenced code block moves the whole block below its
  next sibling; a single undo restores the pre-move source.
- Alt+ArrowUp on a focused thematic break moves it above its previous sibling.

## Edge cases

- A single undo after a reorder restores the exact pre-move source.
- Alt+ArrowUp on the first sibling / Alt+ArrowDown on the last is a no-op
  (clamped — no move, no error).

## User interactions

- Real keyboard chord (`Alt+ArrowUp` / `Alt+ArrowDown`) on a focused block.
- Plain ArrowUp/ArrowDown still navigate the caret across block boundaries;
  the Alt modifier is what selects reorder over navigation.
