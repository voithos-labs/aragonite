# Feature: Mermaid whole-block focus + two-step delete

An opaque childless plugin container (the ` ```mermaid ` block) opts into editor-level
whole-block focus via `blockFocus: 'whole-block'`. Arrow traversal stops on it, a
caret-adjacent Backspace/Delete focuses it before a second press deletes it, Enter inserts a
paragraph below, and Alt+arrows reorder it — ThematicBreak's focus-then-delete model, exposed
through the public container factory. The rendered viewport (`tabindex=0`) is the shared focus
surface for keyboard and mouse, and the `:focus-within` border/background is the highlight.

Fixture (loaded per test): a paragraph `Above text`, a valid ` ```mermaid ` diagram, a
paragraph `tail text` — so the block has an editable neighbor on each side.

## Happy paths

- ArrowUp from `tail text` focuses the mermaid block (viewport focused, focus editor-owned);
  a second ArrowUp exits to `Above text`
- ArrowDown from `Above text` (caret at end) focuses the mermaid block; a second ArrowDown
  exits to `tail text`
- ArrowLeft at offset 0 of `tail text` focuses the mermaid block; ArrowRight at the end of
  `Above text` mirrors
- Enter while the block is focused inserts an empty paragraph below with the caret in it; the
  diagram's source is unchanged and the document round-trips
- Alt+ArrowDown reorders the mermaid block below its next sibling; Alt+ArrowUp moves it back
- Mod+C while the block is focused copies its ` ```mermaid ` markdown; the document is
  unchanged (the container-factory pin for the shared whole-block copy tail)
- Mod+X while the block is focused copies the markdown and deletes the block; one Mod+Z
  restores it

## User interactions

- Backspace at offset 0 of `tail text` focuses the mermaid block with the source byte-unchanged;
  a second Backspace deletes the block, and one undo (Mod+Z) restores it byte-exactly
- Delete at the end of `Above text` focuses the mermaid block; a second Delete deletes it
  (forward twin of the Backspace path)
- Clicking the diagram focuses the viewport (`:focus-within` highlight); a single Backspace then
  deletes the block — the click is the highlight step
- Backspace and typing inside the plugin's edit `<textarea>` (opened by double-click) edit the
  draft and never delete the block

## Edge cases

- After the two-step delete, focus lands on the surviving neighbor (the existing delete-path
  landing), so a following Mod+Z undo resolves at the editor-global tier
- The error/loading/static states are whole-block focus surfaces of their own — covered by
  the sibling `mermaid-broken-focus` requirements (this file's fixture uses a valid diagram)

## Miss-analysis

- 2026-07 (defect: the broken-fence block was a caret trap): this file's first edition
  explicitly carved the error state out as "inert" instead of pinning its behavior — a
  requirement that names a state must state what the user CAN do there, never wave it off;
  the sibling `mermaid-broken-focus.md` now pins every affordance in the error state.
