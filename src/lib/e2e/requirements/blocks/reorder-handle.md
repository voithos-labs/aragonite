# Feature: hover drag handle (presence, a11y, gating, toggle)

The handle is for the mouse only. Keyboard reorder (Alt+Arrow) is the path
anyone can operate, so the handle stays out of the screen reader and the tab
order. This file covers which blocks show a handle and when, not dragging.

## Happy paths

- hover a top-level block: its drag handle appears (opacity 0 → 1)
- hover a list item: exactly one handle appears inside the item and its children
- hover a blockquote child: its drag handle appears

## Which blocks carry one

- prose carries none: paragraph, heading, blockquote, and the note cards (admonition,
  GitHub alert). They stay reorder units (`reorder-host`, keyboard reorder, a drop neighbour)
- the list as a whole carries none either: its handle would sit in the gutter on top of its
  first item's and take the click with it, so hovering the first row would light the list's
  handle instead. A list moves one item at a time, so the items carry the handles
- the objects a user picks up whole carry one: code, tables, equations, diagrams, pictures,
  list items, dividers, `<details>`, and the other plugin cards
- a paragraph holding nothing but images is a picture, not prose, so it carries one; an image
  beside words is a prose paragraph again and carries none
- a picture's handle does not wait for the `blockDragHandles` opt-in either, since dragging is
  the only way to move one with the pointer, but reading mode still shows no handle anywhere
- a table shows one handle, its own: there are no per-row or per-column handles, and every row
  and column action lives in the right-click cell menu

## Handle glyph and placement

- the handle is the lucide `grip-vertical` glyph (six dots), 16px, muted
- the handle sits within the first line-height of the block's own box, measured on hover, not
  on its first line of text: a card pads above that text, so a handle level with the first code
  line would hang below the card's top edge. A code card, an equation, a table and a picture
  all take a handle near their top edge rather than centred or level with their first line
- a `data-drag-anchor` element shorter than a line centres the handle on itself instead (the
  task item's checkbox, which is taller than the text beside it); a taller one is a card, and
  the first line-height already covers it
- the handle sits in the editor's left gutter and clears the block's content by about 4px
- before any hover (and on touch, which never hovers) half the block's line-height stands in

## Reach

- the handle can be hit on its own, without hovering the block first: coming into the gutter
  from the side shows it and lands on it, so you never cross the block to reach it
- while the block itself is hovered the whole gutter strip stays live, so a pointer gliding out
  of the block never crosses a gap where nothing responds

## Edge cases

- the handle is hidden (opacity 0) until its block is hovered: CSS alone shows it, with no reactive state
- a list item's inner content paragraph is not a reorder unit: no handle on it, so the item and its children still show exactly one
- hovering a nested block does not show an ancestor's handle (the `> ` child selector)

## Accessibility

- the handle carries `aria-hidden="true"` and is neither focusable nor named
- the axe accessibility baseline stays green with handles rendered

## Toggle

- `blockDragHandles=false` (via `?dragHandles=false`): no handle renders anywhere, even on hover
- the prop is opt-in: an `<Editor>` that leaves it out renders no handle (a unit test pins this in
  `test/components/drag-handle-default.svelte.test.ts`, since this route always passes it explicitly)
