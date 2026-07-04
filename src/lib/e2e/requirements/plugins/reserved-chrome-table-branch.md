# Feature: Fork-A Spike — Reserved-child-0 Chrome Wall × Table Branch

The `:::note` callout reserves child index 0 as an editable `note-title` chrome
leaf. This gate proves the rangeDelete wall holds when a range endpoint is a table
cell (the table branch dispatches ahead of the chrome branch). Behavioral gate:
CST/selection read by path via `window.__test`, not visuals.

## Gate 6 — chrome wall × table branch (must pass)

Ranges with a table endpoint dispatch to the table branch ahead of the chrome
branch, so the wall rule must hold there too: covered chrome clears, chrome
endpoints truncate in place, and a fully-consumed container unit-deletes.

- substrate: a table in the callout body parses as a real child (title + table)
- between (prose → body table cell): the title clears in place to an empty note-title, the table takes its whole-row-snap semantics, nothing hoists into the opener line; undo restores the title at the CHILD level
- chrome-start endpoint (mid-title → body table cell): the title truncates by raw write — kind and node survive, no reparse-replacement; the caret stays in the title; undo restores at the child level
- chrome-end endpoint (table above → mid-title): the title keeps its uncovered tail in the chrome leaf; the start table takes its row semantics
- table → table across the wall: the strictly-between title clears, never node-deletes (shared deletion-collection coverage)
- whole-subtree consumed via a table-involving range: the container dies as ONE splice, children intact — undo restores title and body together
- state audits include table-kind state: a whole-row-snap delete commits the endpoint table as its own scope, so its row ids/refs stay in lockstep with children

## User interactions

- pointer drag (cell → cell, prose → cell), Delete, Ctrl+Z are real gestures; assertions read the CST/selection by path, never the DOM shape
