# Feature: Table action menu keyboard + screen-reader access

The table affordance menu ships with one mouse trigger, a right-click on a cell. This
covers the keyboard-only path into and through the menu, and the live-region
announcements for the structural ops that the mouse path also reaches.

## Happy paths

- Shift+F10 (or the ContextMenu key) on a focused cell opens the both-axes menu and moves focus to the first enabled item.
- Arrow keys move roving focus between menu items; Enter invokes the focused item and the menu closes.
- The cell menu folds insert/move actions into Row and Column flyouts (Delete row/column and alignment stay top-level): Right on a group row opens its flyout on the first enabled item, Left closes it and returns focus to the group row.
- Left/Right arrows move focus within the alignment trio (Left/Center/Right segments) without leaving the group.
- Escape closes the menu and returns focus to the originating cell, so typing lands back in the table.

## Edge cases

- The first focused item is never a disabled one (disabled items are skipped, not focus stops).
- Arrow navigation steps over a disabled item mid-menu (including inside a flyout) — it never lands on a disabled stop.
- Arrow navigation wraps at the ends: Up from the first item lands on the last stop.
- Tab and Shift+Tab stay within the open menu — focus can't escape into the document behind it.

## Announcements

- Inserting a column announces via the live region.
- A move taken through the Row flyout announces the row's new position, as the chord does.
- Deleting a row announces via the live region.
