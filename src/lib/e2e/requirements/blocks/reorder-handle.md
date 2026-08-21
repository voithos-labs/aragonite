# Feature: hover drag handle (presence, a11y, gating, toggle)

The handle is a mouse-only affordance. Keyboard reorder (Alt+Arrow) is the
accessible, operable path; the handle stays out of the screen-reader/tab flow.
This task adds presence + gating only — no drag behavior yet.

## Happy paths

- hover a top-level block: its drag handle reveals (opacity 0 → 1)
- hover a list item: exactly one handle reveals in the item subtree
- hover a blockquote child: its drag handle reveals

## Edge cases

- handle is hidden (opacity 0) until its host is hovered — pure-CSS reveal, no reactive state
- a list item's inner content paragraph is NOT a reorder unit: no handle on it (exactly one handle per item subtree)
- nested host hover does not reveal an ancestor's handle (`> ` child selector)

## Accessibility

- handle carries `aria-hidden="true"` and is not a focusable/named element
- axe baseline-ratchet stays green with handles rendered

## Toggle

- `blockDragHandles=false` (via `?dragHandles=false`): no handle renders anywhere, even on hover
- the prop is opt-in: an `<Editor>` that omits it renders no handle (unit-pinned in
  `test/components/drag-handle-default.svelte.test.ts`, since this route always passes it explicitly)
