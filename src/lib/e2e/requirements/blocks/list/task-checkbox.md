# Block: List — Task Checkbox

Interactive `[x]` / `[ ]` toggling on GFM task list items. Click toggles via metadata path; completed tasks get visual distinction.

## Happy paths

- Clicking an unchecked checkbox (`[ ]`) toggles to checked (`[x]`); source reflects the new state.
- Clicking a checked checkbox (`[x]`) toggles to unchecked (`[ ]`); source reflects the new state.
- Toggled state persists across a serialize round-trip.
- Completed tasks render with strikethrough and muted color; unchecked tasks render normally.

## Edge cases

- Clicking the checkbox does not change the caret position when the caret was elsewhere (click region is non-editable, browser preserves selection).
- Clicking the checkbox with an active cross-block selection collapses the selection first, then applies the toggle; only the clicked item is affected.
- Typing `[ ] ` at the start of a plain list-item paragraph auto-converts the item to a task item on next parse (ambient region renders a checkbox).
- The `[x]` characters inside the ambient region cannot be edited via keyboard (contenteditable="false" island).
- Keyboard caret navigation through the list item skips the ambient region cleanly (Home / ArrowLeft / ArrowRight at boundary).

## User interactions

- Hover over the checkbox changes cursor to pointer and applies a subtle background tint.
- Click → Ctrl+Z restores pre-toggle source and unchecked state.
- Click → Ctrl+Z → Ctrl+Y restores post-toggle source and checked state.
- Uppercase variant `[X]` parses to checked; after a toggle, the marker normalizes to canonical `[x]` (documented behavior).

## Accessibility

- The checkbox span carries `role="checkbox"` and `aria-checked` reflecting current state.
- `aria-checked` flips synchronously with toggle.

## Regression guards

- Toggle does not emit typing-style keyboard events; emitted edit event has `op: 'metadataUpdate'`.
- Undo after toggle pushes one snapshot (not zero, not two).
- Nested task sub-lists render independently — toggling an outer task item does not strike through its nested task sub-list's text.
- Enter at end of a task list item creates a new unchecked task item (inherits task-ness from source); plain list items stay plain.
