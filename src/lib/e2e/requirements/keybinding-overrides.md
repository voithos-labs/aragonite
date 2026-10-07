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
- the undo/redo chords (Mod+Z / Mod+Y / Mod+Shift+Z) are themselves overridable even
  though they are intercepted at the input layer to suppress the browser's own history:
  the interception routes through the same override-aware dispatch
- a modified variant of an undo/redo chord (e.g. Mod+Alt+Y) is not swallowed as redo and
  reaches its own override (regression guard: a loose `key==='y'` check used to catch it)

## Override scope

- a `kind:'heading'` override fires when a heading is focused but not on a paragraph

## Pinned below the browser

These run against the mounted editor, in `range-command-keys.test.ts`, `keybinding-overrides.test.ts` and `item-tab-keydown.test.ts`:

- a malformed chord (`'Ctrl+B'`) is dropped and does not bind bare B
- a `kind:'listItem'` override disabling Tab, and a global disable of Tab, each stop the list indent as the key travels up to the container (the leaf never takes Tab inside a list)
  - Miss-analysis: every override row drove a leaf block, so none saw the list item's own key handler
- over a selection spanning blocks, a command key removes the selection and then runs at the caret that's left, and the bindings decide which keys those are: a disabled `Mod+2` or `Enter` (global, or scoped to the paragraphs the selection lands in) removes nothing and the selection stays, a split bound to `Mod+J` on headings does nothing over paragraphs, and a heading rebound to `Mod+Alt+2` or a split rebound to `Alt+Enter` removes the selection and runs
  - Miss-analysis: the cross-block command-key rows only pressed the default chords, where the literal keys and the keymap agree, so nothing saw a disabled key delete the selection or a rebound one do nothing; and every kind-scoped row pressed the key in a block of the landing's kind, so none saw the block holding focus run its own Enter under the live selection

## User interactions (real keys, every leaf dispatch surface)

- a rebound add-chord undoes an edit made in a paragraph (`TextEditableBlock`), a code block (`CodeBlock`) and a table cell (`TableCellBlock`)
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
  `clipboard/cross-block-destructive-keys.spec.ts`; the rebound and disabled ones are pinned in `range-command-keys.test.ts`.
