# Feature: an inline-menu pick that waits

A menu's `pick` may wait before it writes, and writes nothing until it does: its `MenuPick` holds
the trigger and the query, and lands as an undo step of its own once it commits. A menu that waits
on something slow (a fetch for a title, a dialog) leaves the author typing in the meantime, and the
author's own edits are not the pick's. Seed `inline-menu` installs a card picker on `@`
(`inline-menu/held-commit-menu-plugin.ts`) whose pick waits until the spec releases it, then puts a
card below the line in place of the query.

## Undo

- Pick, type two characters while the pick waits, release it: the query goes, the card lands below
  the line, and the history holds three entries. The first Ctrl+Z takes back the card and brings
  the query back, keeping the typing; the second removes the typing; the third removes the typed
  query. Miss-analysis: the join cases only ever wrote from inside the pick, and no source held its
  commit open while the author typed.

## Across a source swap

- Pick, then the host loads another note before the pick is released: the release writes nothing
  into the new note and fires no `edit`. Miss-analysis: every held-commit row released the commit
  into the note it was picked in. The slash list's host rows had the same hole: every row that ran
  a host function ran it at once, in the note it was picked in.
- Pick, the host loads another note and writes into it itself, then the pick is released: the
  host's write lands, and the pick's card doesn't
- Pick, switch to live mode while the pick waits, release it: a mode change replaces no document,
  so the pick is left alone and the card lands
