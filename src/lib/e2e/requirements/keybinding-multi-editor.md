# Feature: multi-editor document-chord containment

Two (or more) editors mounted on one page share the document-level keydown
listener each installs. Every document-level chord an editor owns — the search
shortcuts, undo/redo, plugin-global chords, cross-block motion — must stay
contained to a single instance, so one keypress never drives two editors.

## Happy paths

- an in-focus Ctrl+F opens only the focused editor's search bar, never the other's

## Edge cases

- a body-level chord (the caret's block windowed out and blurred to `<body>`) is
  claimed by the editor the user last interacted with, and by that one only — one
  Ctrl+Z reverts the last-interacted editor and leaves the other's edit intact
  (regression: it used to revert BOTH editors)

## Error cases

- Ctrl+F with focus in an element outside every editor (a page control, an
  unrelated input) opens no search bar — outside focus must not steer any
  instance's search bar (regression: it opened the editor's search and stole focus)
