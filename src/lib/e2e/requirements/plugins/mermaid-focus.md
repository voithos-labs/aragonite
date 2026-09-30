# Feature: Mermaid whole-block focus + two-step delete

An opaque childless plugin container, the ` ```mermaid ` block, opts into editor-level
whole-block focus with `blockFocus: 'whole-block'`. The arrow keys stop on it, a Backspace or
Delete next to it focuses it before a second press deletes it, Enter inserts a paragraph below,
and Alt+arrows move it: the same focus-then-delete model as ThematicBreak, offered through the
public container factory. The rendered diagram is the element the block declares, and what a
pointer lands on; the editor hands that arrival to a hidden editing host in the block's frame,
which is where DOM focus sits and what the focus assertions name. The `:focus-within` border and
background are still the highlight.

Fixture (loaded per test): a paragraph `Above text`, a valid ` ```mermaid ` diagram, and a
paragraph `tail text`, so the block has an editable neighbor on each side.

## Happy paths

- ArrowUp from `tail text` focuses the mermaid block, with the editing host focused and focus
  owned by the editor; a second ArrowUp leaves for `Above text`
- ArrowDown from `Above text`, caret at its end, focuses the mermaid block; a second ArrowDown
  leaves for `tail text`
- ArrowLeft at offset 0 of `tail text` focuses the mermaid block, and ArrowRight at the end of
  `Above text` does the same in the other direction
- Enter while the block is focused inserts an empty paragraph below with the caret in it; the
  diagram's source is unchanged and the document round-trips
- A character typed while the block is focused creates that same paragraph below carrying the
  character, with the caret after it, which is the container factory's pin for the shared
  behavior on a printable key
- Alt+ArrowDown moves the mermaid block below its next sibling, and Alt+ArrowUp moves it back
- Mod+C while the block is focused copies its ` ```mermaid ` markdown and leaves the document
  unchanged, the container factory's pin for the shared whole-block copy
- Mod+X while the block is focused copies the markdown and deletes the block, and one Mod+Z
  restores it
- Mod+Z while the block is focused undoes the last edit, and a `keybindings` rebind onto a chord
  the built-in table does not own (`Mod+Alt+U`) undoes there too. No inner leaf carries the
  editor-wide level for a plugin container and the editor root declines while the block's box
  holds focus, so this handler is the only thing between the keypress and the browser's own undo
  (miss-analysis: the built-in counterpart, ThematicBreak, had a component-level chord test and
  this call site had none, and every override case anywhere re-pointed a chord the built-in
  table already owned)

## User interactions

- Backspace at offset 0 of `tail text` focuses the mermaid block with the source unchanged; a
  second Backspace deletes the block, and one undo (Mod+Z) restores it byte for byte
- Delete at the end of `Above text` focuses the mermaid block, and a second Delete deletes it,
  the forward counterpart of the Backspace path
- Clicking the diagram focuses the block, the click handed on to the editing host and the
  `:focus-within` highlight showing; a single Backspace then deletes the block, since the click
  did the highlight step
- Backspace and typing inside the plugin's edit `<textarea>`, opened by double-click, edit the
  draft and never delete the block

## Edge cases

- After the two-step delete, focus lands on the surviving neighbor, as it does after any
  delete, so a Mod+Z straight after resolves at the editor-wide level
- The error, loading and static states are whole-block focus targets in their own right,
  covered by the sibling `mermaid-broken-focus` requirements, since this file's fixture uses a
  valid diagram

## Miss-analysis

- 2026-07 (defect: the broken-fence block was a caret trap): this file's first edition
  explicitly set the error state aside as "inert" instead of pinning its behavior. A
  requirement that names a state has to say what the user can do there rather than wave it off,
  and the sibling `mermaid-broken-focus.md` now pins everything the error state supports.
