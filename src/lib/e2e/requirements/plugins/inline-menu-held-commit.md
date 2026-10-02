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

## Across a source swap

- Pick, then the host loads another note before the commit is released: the release writes
  nothing into the new note and fires no `edit`. Miss-analysis: every held-commit row released
  the commit into the note it was picked in.
- Pick, the host loads another note and writes into it itself, then the commit is released: the
  host's write lands, and the pick's card doesn't
- Pick, switch to live mode while the commit waits, release it: a mode change replaces no
  document, so the pick is left alone and the card lands
