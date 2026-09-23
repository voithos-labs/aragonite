# Feature: Block decorations on table rows and cells

A table row and a table cell render their own elements instead of a block host, so a `block`
decoration addressed to a row's or a cell's path lands on that element: the class and
attributes on it. Neither can hold a badge. A row has no box of its own (`display: contents`),
and a cell's children are its editable text, which every keystroke re-renders, so a badge
addressed to either is refused with a `decorations` warning and the rest still lands.

## Happy paths

- A decoration on a body row puts its class and attributes on that row only
- A decoration on a cell puts its class and attributes on that cell only
- Disposing the source removes the class and the attributes from the row and the cell

## Edge cases

- A badge on a row is refused with a `decorations` warning; the row's class still lands and no
  badge enters the table
- A badge on a cell is refused with a `decorations` warning; the cell's class still lands, no
  badge enters the table, and the cell's text is unchanged
- An attribute the cell renders itself (`contenteditable`) is refused with a `decorations`
  warning, and the cell stays editable after the source is disposed
- A `class` passed in a row decoration's attrs is refused with a `decorations` warning; the row
  keeps `table-row` while the source is live and after it is disposed

## Miss-analysis

- The list item fix gave its own box the shared decoration code, and no case addressed the other
  nodes that render without a block host, so rows and cells stayed undecorated
- A decoration's attrs could replace the `class` an element renders itself: the refused names
  covered each element's own extras, and no case passed `class` through attrs
