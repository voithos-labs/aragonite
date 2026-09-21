# Feature: the trailing insert row and the block menu

Below the last block sits a full-width, invisible row: a click on it appends an empty paragraph
and lands the caret there, so there is always somewhere to write after a table, a fence or an
equation. It shows no control of its own, since the row itself is the control, and a drag
that starts on it is the editor's own drag-select, like one from any other margin. A right-click
on a paragraph opens the clipboard rows with an "Insert block" flyout (`context-menu-insert.md`);
a right-click on a non-prose block opens that block's actions (its kind's registered rows, then
copy, replace with clipboard, remove). Every menu is driven by pointer or keyboard without taking
focus, and announces itself on the `menuChange` channel so a host's own UI over the selection can
step aside.

## Happy paths

- clicking the tail row on a document ending in a code block appends a paragraph, and the next
  keys type into it
- a drag that starts on the tail row selects into the block above it and appends nothing: the
  row's click is for a click that stayed put
  - Miss-analysis: the tail row's tests all clicked it, and the drag tests all started in a
    block, so the one gesture that begins on the row and ends somewhere else had no test at all
- the row carries no `+` of its own: empty blocks are added from the right-click menu's "Insert
  block" flyout (`context-menu-insert.md`), which the keyboard's own menu key reaches too
  - Miss-analysis: nothing asserted the row's contents, so a button could be added or removed
    without a test noticing; whether what it offered could be reached was covered only where that
    menu is tested
- a right-click on a code block opens `Block actions`; its Remove row deletes the block and the
  neighbours close up
- ArrowUp from the first row wraps to the last selectable row; ArrowDown wraps back

## User interactions

- Escape closes the menu and inserts nothing; what the caret was in stays typable
- `menuChange` fires `true` once as the menu opens and `false` once as it closes, never at mount

## Error cases

- zero `[invariant:…]` console fires across the menu interactions (automatic via the shared
  e2e fixture)
