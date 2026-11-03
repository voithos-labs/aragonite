# Feature: a host's own shortcuts around the editor

`/test/host-chords` mounts a paragraph and a table under a host that listens for keys on the
window in the capture phase, the way a desktop app does, and runs its own action on Alt or Ctrl
with ← or → unless `claimsChord` says the editor takes the key. The page records each action it
ran.

Miss-analysis: `claimsChord` read every block kind's keymap at once and no test put a host around
the editor, so the table's Alt+←/→ were claimed in a paragraph and a host's Back and Forward died
whenever the caret was in a document.

## Happy paths

- the caret in a paragraph, Alt+← (off a Mac): the host's action runs and the document is unchanged
- the caret in a table cell, Alt+← (off a Mac): the host's action doesn't run, and the cell's column
  moves left

## Edge cases

- the caret in a paragraph, the word key and → (Ctrl off a Mac, Option on one): the host's action
  doesn't run, and the caret moves forward by a word
- on a Mac, Option+← is the word key, so the host never sees it in a document; the table's column
  chords are Windows and Linux only, so the cell row runs off a Mac

## User interactions

- a click places the caret and a real keystroke goes through the host's listener, then the editor's
