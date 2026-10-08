# Feature: hover drag handle (presence, a11y, gating, toggle)

The handle is for the mouse only. Keyboard reorder (Alt+Arrow) is the path
anyone can operate, so the handle stays out of the screen reader and the tab
order. This file covers which blocks show a handle and when, not dragging.

## Happy paths

- hover a top-level block: its drag handle appears (opacity 0 → 1)
- hover a list item: exactly one handle appears inside the item and its children
- hover a blockquote child: its drag handle appears. So does a child of any container whose
  children reorder (a GitHub alert, a footnote), since a drag moves what Alt+Arrow moves

## Which blocks carry one

The objects a user picks up whole carry a handle: code, tables, equations, diagrams, pictures,
list items, dividers, `<details>`, and the other plugin cards. A table shows one handle, its own:
there are no per-row or per-column handles, and every row and column action lives in the
right-click cell menu.

- the list as a whole carries none: its handle would sit in the gutter on top of its first item's
  and take the click, so hovering the first row lights that row's handle alone

## Handle glyph and placement

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
- hovering a nested block does not show an ancestor's handle (the `> ` child selector)

## Accessibility

- the handle carries `aria-hidden="true"` and is neither focusable nor named
- the axe accessibility baseline stays green with handles rendered

## Pinned below the browser

These mount the editor without a page and count handles:

- prose carries none: paragraph, both heading syntaxes, a blockquote and its paragraphs, a note card
  (`test/components/drag-handle-default.svelte.test.ts`)
- code and list items carry one, and a list item's inner paragraph doesn't, so an item and its
  children show exactly one
  (`test/components/drag-handle-default.svelte.test.ts`)
- an image-only paragraph carries one; an image beside words carries none
  (`test/components/drag-handle-default.svelte.test.ts`)
- the only item of a list carries none until a sibling joins it
  (`test/components/drag-handle-default.svelte.test.ts`)
- reading mode shows none, not even on an image-only paragraph
  (`test/components/drag-handle-default.svelte.test.ts`)
- the handle is the lucide `grip-vertical` glyph, six dots
  (`test/components/drag-handle-default.svelte.test.ts`)
- the prop is opt-in, and `blockDragHandles=false` renders no handle (a picture keeps its own, and
  `e2e/tests/blocks/reorder-drag.spec.ts` drags it)
  (`test/components/drag-handle-default.svelte.test.ts`)
