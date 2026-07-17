# Feature: keybinding-override prop

The `keybindings` prop maps consumer chords onto the built-in command vocabulary,
per mounted editor. Overrides shadow or disable the built-in keymap without
mutating the global tables.

## Happy paths

- rebind a global default: `{chord:'Mod+Y', command:'history.undo'}` makes Mod+Y undo
- add a new chord: `{chord:'Mod+Alt+U', command:'history.undo'}` makes that chord undo

## Edge cases

- disable a default: `{chord:'Mod+Z', command:null}` makes Mod+Z no longer undo (the edit survives)
- clearing the prop restores the built-in default (proves overrides never mutate the global keymap)
- malformed chord (`'Ctrl+B'`) is dropped and does NOT bind bare B
- the undo/redo chords (Mod+Z / Mod+Y / Mod+Shift+Z) are themselves overridable even
  though they're intercepted at the input layer for native-history suppression — the
  interception routes through the same override-aware dispatch
- a modified variant of an undo/redo chord (e.g. Mod+Alt+Y) is NOT swallowed as redo —
  it reaches its own override (regression guard: a loose `key==='y'` check used to catch it)

## Override scope

- a `kind:'heading'` override fires when a heading is focused but not on a paragraph
- a `kind:'listItem'` override disabling Tab makes Tab no longer indent the item
  (the container-bubble `resolveKindBinding` path — the leaf never claims Tab inside a list)
- a GLOBAL (kind-less) disable of Tab ALSO stops the list indent: the container bubble
  consults `override(global)`, so a per-instance decision means the same at the leaf and
  the bubble (regression: the bubble used to ignore global overrides and Tab still indented)

## User interactions (real keys, every leaf dispatch surface)

- a rebound add-chord undoes an edit made in a paragraph (TextEditableBlock)
- a rebound add-chord undoes an edit made in a code block (CodeBlock)
- a rebound add-chord undoes an edit made in a table cell (TableCellBlock)

## Notes

- Two simultaneous live editors with different props is the literal isolation proof, but
  mounting two editors trips other not-yet-per-instance globals (state-registry, doc-level
  Ctrl+F) — the 1.1 multi-editor work. The "clear restores default" scenario proves the
  non-global guarantee without a second instance.
- The cross-block keydown surface is exercised by the existing cross-block delete specs
  once the wiring lands; a global rebind reaching it needs an active cross-block selection
  collapsed onto a command key, which those specs already drive.
