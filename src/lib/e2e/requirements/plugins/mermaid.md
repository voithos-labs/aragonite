# Feature: Mermaid diagram block, the render-primary reference plugin

A ` ```mermaid ` fence takes a childless plugin container whose code lives in metadata. The
component renders the diagram SVG through an injected renderer, with an edit mode the plugin
owns, a textarea that commits through `updateOwnMetadata` as one undoable entry, pan and zoom on
the rendered SVG once it has focus, and a focus overlay in a fixed position. The block takes
editor-level whole-block focus (`blockFocus: 'whole-block'`), so the arrow keys stop on it and a
Backspace or Delete next to it focuses then deletes it in two steps, covered in the sibling
`mermaid-focus` requirements. A plain fence with any other info string has to stay the built-in
`fencedCode`. Focus shows on the whole block as an accent border with no inner outline, and the
toolbar (Edit, Focus, Reset view) stays hidden until the block is hovered or focused.

## Happy paths

- The seed renders both valid diagrams as the `mermaid` kind, through the bridge's tree path,
  with a rendered `<svg>` in each, and the ` ```js ` block stays `fencedCode`
- Edit flow: the Edit button swaps in a textarea holding the fence's code; changing the code and
  pressing Ctrl+Enter re-renders, and `getSource()` reflects the new code byte for byte inside
  the same fence
- One undo (Mod+Z) after a commit restores the previous source byte for byte, both with the
  caret left elsewhere and with the diagram itself focused
- Focus view: the Focus button opens the overlay, and Escape closes it, asserted by the overlay
  being there or not
- The `Mod+M` chord for this kind opens the focus view when the diagram has focus, through the
  block command the plugin registered

## User interactions

- A single click on the rendered view focuses the diagram without showing its source; a double
  click enters edit mode, with the textarea holding the fence code
- Tab inside the source textarea inserts a tab character at the caret and stays in edit mode,
  since Escape, not Tab, is the way out

## Error cases

- Invalid diagram code renders a readable inline error rather than throwing, and the editor
  keeps working, so typing in the paragraph below still edits it

## Edge cases

- Escape in the textarea cancels the edit: the code and `getSource()` are unchanged
- Committing by blurring, which means clicking another block, keeps the edit the same way
  Ctrl+Enter does
- Round-trip stability after the whole flow: `getSource()` parses and serializes again to the
  same bytes
- A change to the code that lands while the edit box is open fills the textarea again, and the
  commit on blur writes nothing that reverts it (driven at the unit level, where the live tree
  is reachable)

## Miss-analysis

The undo scenario above was satisfied by a test that moved focus off the block first, so undo
from the kind's own focused block, where a keyboard commit leaves it, was never pressed. The
conformance kit's undo column checks how many entries an edit makes, never whether a chord is
reachable from a focused block, and no requirement covered a change to the tree from outside
landing while a plugin's editing area is open at all.
