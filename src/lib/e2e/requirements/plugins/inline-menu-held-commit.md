# Feature: an inline-menu pick whose commit waits

A source's `onCommit` may return a promise, and the writes it makes while that promise is pending
join the pick's undo entry. A source that waits on something slow (a fetch for a title, a dialog)
keeps that promise pending while the author goes on typing, and the author's own edits are not the
pick's. Seed `inline-menu` installs a mention source on `@`
(`inline-menu/held-commit-menu-plugin.ts`) whose `onCommit` waits until the spec releases it, then
inserts a card below.

## Undo

- Pick, type two characters while the commit waits, release it: the card lands, and the history
  holds three entries. The first Ctrl+Z removes the card and keeps the typing, the second removes
  the typing, the third restores the typed query. Miss-analysis: the join cases only ever wrote
  from inside the pick, and no source held its commit open while the author typed.
- Pick, press and release Shift alone while the commit waits, release it: a bare modifier is not
  input, so one Ctrl+Z takes back the pick and the card together.
