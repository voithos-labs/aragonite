# Feature: Spelling ops, a picked suggestion (note-taking simulation)

A session on `/test/editor?spell=on` over the spellcheck package. The pick runs through the
right-click menu the way a user reaches it, and the reference checks (the console watcher, the
live-tree round-trip, the block-list audit, and the reparse comparison) run after the load, the
pick and the undo. Parked until the editor reads blocks and paints, which the package's capture and
its waves need.

## Happy paths

- a picked suggestion rewrites one word, and one Ctrl+Z gives the bytes back: right-clicking the
  misspelled word and picking the row the menu leads with changes only that word's bytes, and one
  undo returns the document to its loaded bytes
