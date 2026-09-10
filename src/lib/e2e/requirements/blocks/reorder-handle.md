# Feature: hover drag handle (presence, a11y, gating, toggle)

The handle is a mouse-only affordance. Keyboard reorder (Alt+Arrow) is the
accessible, operable path; the handle stays out of the screen-reader/tab flow.
This task adds presence + gating only — no drag behavior yet.

## Happy paths

- hover a top-level block: its drag handle reveals (opacity 0 → 1)
- hover a list item: exactly one handle reveals in the item subtree
- hover a blockquote child: its drag handle reveals

## Which blocks carry one

- prose carries none: paragraph, heading, blockquote, and the note cards (admonition,
  GitHub alert). They stay reorder units (`reorder-host`, keyboard reorder, a drop neighbour)
- the list SHELL carries none either: its grip would land in the gutter on top of its first
  item's and take the hit test with it, so a hover over the first row lit the shell's grip
  instead. A list moves an item at a time; the items carry the grips
- the objects a reader picks up whole carry one: code, tables, equations, diagrams, pictures,
  list items, dividers, `<details>`, and the other plugin cards
- a paragraph holding nothing but images is a picture, not prose, so it carries one; an image
  beside words is a prose paragraph again and carries none
- a picture's handle does not wait for the `blockDragHandles` opt-in either — dragging it is
  the only pointer road to move one — but reading mode still shows no handle anywhere
- a table shows ONE handle, its own: the per-row and per-column grips are gone, and every
  row/column action lives in the right-click cell menu

## Grip glyph and placement

- the grip is the lucide `grip-vertical` glyph (six dots), 16px, muted
- the seat is the first line-height of the block's OWN box, measured on hover — not its first
  line of text: a card pads above that text, and a grip level with the first code line hangs
  below the card's shoulder. So a code card, an equation, a table and a picture all take a grip
  near their top edge rather than centred or level with their first line
- a `data-drag-anchor` marker SHORTER than a line centres the grip on itself instead (the task
  item's checkbox, which is taller than the text beside it); a taller one is a card, and the
  band already covers it
- the grip sits in the editor's left gutter and clears the block's content by ~4px
- before any hover (and on touch, which never hovers) the host's half line-height stands in

## Reach

- the grip is hittable on its own, without hovering the block first: coming into the gutter
  sideways reveals it and lands on it, so it is not a flyout you traverse the block to reach
- while the block IS hovered the whole gutter strip stays live, so a pointer gliding out of the
  block never crosses a dead gap

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
