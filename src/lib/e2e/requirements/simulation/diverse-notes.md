# Feature: Diverse notes (note-taking simulation)

Three of the diverse notes type a construct that nothing else in the gate types, and the
end-state check (typing the note gives the same document as loading it) is what guards it. So
they run on every `npm test`, with the screenshots off. `diverse-notes-capture.md` is the same
sessions with the screenshots on, for the visual review.

## Happy paths

- the outline note builds a three-level nested bullet list by the deep-nesting cadence (type an
  item, Enter, indent the empty item, type the new one); the three levels are part of the end
  state, so a nesting regression fails it. Nesting an empty item writes a blank line above it,
  so each sublist typed that way reads loose, in the typed note and the canonical one alike
- the reading-notes note builds a nested `> >` quote, then leaves it with three Enters: one opens
  an empty `> >` line, and each Enter on an empty quote line leaves one level. The end state holds
  the nested quote with no stranded `> >` or `>` line after it, which is the guard for the
  nested-quote exit fix
- the project-plan note builds nested bullets, a nested ordered item, a task list, a two-paragraph
  quote, a fenced code block and a resized picture, all part of the end state. One of its seed's
  detours is a Backspace over the whole note, a range that ends on that picture
- #817: on the loaded project-plan note, Mod+A twice and a typed letter leave only that letter,
  though the range ends on the picture that closes the note

## Error cases

- each session holds every reference check the harness runs: no console or page errors, the
  serializer round-trips the tree at each checkpoint, the nested-state audit finds nothing out of
  step, and the undo/redo differential restores the exact source around a forced batch boundary
