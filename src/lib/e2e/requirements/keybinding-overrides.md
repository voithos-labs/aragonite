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
- malformed chord (`'Ctrl+B'`) is dropped and does not bind bare B
- the undo/redo chords (Mod+Z / Mod+Y / Mod+Shift+Z) are themselves overridable even
  though they are intercepted at the input layer to suppress the browser's own history:
  the interception routes through the same override-aware dispatch
- a modified variant of an undo/redo chord (e.g. Mod+Alt+Y) is not swallowed as redo and
  reaches its own override (regression guard: a loose `key==='y'` check used to catch it)

## Override scope

- a `kind:'heading'` override fires when a heading is focused but not on a paragraph
- a `kind:'listItem'` override disabling Tab makes Tab no longer indent the item
  (the `resolveKindBinding` path as the key travels up to the container: the leaf never takes Tab inside a list)
- a global (kind-less) disable of Tab also stops the list indent: the container consults
  `override(global)` as the key travels up, so a per-instance decision means the same at the
  leaf and above it (regression: the key's upward travel ignored global overrides and Tab still indented)

## Over a selection spanning blocks

A command key over a selection removes it and then runs at the caret that's left, and which keys
those are comes from the bindings, not the key itself.

- `Mod+2` disabled, pressed over a selection from `alpha` into `beta`: nothing's removed and the
  selection stays
- `Enter` disabled, the same press: nothing's removed and the selection stays
- the heading rebound to `Mod+Alt+2`: that chord removes the selection and makes `## alta`
- the split rebound to `Alt+Enter`: that chord removes the selection and splits, `al` and `ta`
- miss-analysis: the cross-block command-key rows only pressed the default chords, where the
  literal keys and the keymap agree, so nothing saw a disabled key delete the selection or a
  rebound one do nothing
- `Mod+2` disabled on paragraphs only, the same press: nothing's removed, since the selection
  would land in a paragraph and that's where the key is off
- `Enter` disabled on paragraphs only: the same
- a split bound to `Mod+J` on headings only, pressed over the paragraphs: nothing happens and the
  selection stays, since no paragraph binds `Mod+J`
- `Enter` disabled on paragraphs only, over a selection from `alpha` into the heading `# beta`
  with the caret's end in the heading: nothing happens and the selection stays. The selection
  would land in the paragraph, where Enter is off, and the heading doesn't split under it either
- miss-analysis: every binding row above was global, so nothing saw the selection ask a
  different block than the one the command would run in
- miss-analysis: every kind-scoped row pressed the key in a block of the landing's kind, so none
  saw the block holding focus run its own Enter under the live selection

## User interactions (real keys, every leaf dispatch surface)

- a rebound add-chord undoes an edit made in a paragraph (`TextEditableBlock`)
- a rebound add-chord undoes an edit made in a code block (`CodeBlock`)
- a rebound add-chord undoes an edit made in a table cell (`TableCellBlock`)
- a rebound add-chord undoes an edit with the gap caret live between two blocks: no block holds
  focus and there is no kind to fall back on, so the gap's own global handler is the only path
  (miss-analysis: every case in this file drove an editable block, and every override case
  elsewhere re-pointed a chord the built-in table already owned, so four handlers could check
  the built-in table first and no test could tell)

## Notes

- Two simultaneous live editors is the literal isolation proof. Document-level chord
  containment (an outside Ctrl+F stealing focus, and a body-level undo reaching every
  instance) is now covered by `keybinding-multi-editor.spec.ts`. The "clear restores
  default" scenario here proves the single-instance non-global guarantee.
- The default command keys over a selection (Enter, Shift+Enter, Mod+digit) are driven by
  `clipboard/cross-block-destructive-keys.spec.ts`; this file drives the rebound and disabled ones.
