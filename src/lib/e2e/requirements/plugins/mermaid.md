# Feature: Mermaid diagram block — render-primary reference plugin

A ` ```mermaid ` fence claims a childless plugin container whose code lives in metadata;
the component renders the diagram SVG through an injected renderer, with a
plugin-owned textarea edit mode committing through `updateOwnMetadata` as one
undoable entry, focus-gated pan/zoom on the rendered SVG, and a fixed-position
focus overlay. The block takes editor-level whole-block focus (`blockFocus: 'whole-block'`) —
arrows stop on it and a caret-adjacent Backspace/Delete focuses then deletes it in two steps,
covered in the sibling `mermaid-focus` requirements; a plain fence with any other info string
must stay the built-in `fencedCode`. Focus is a whole-block cue (accent border, no inner
outline); the toolbar (Edit / Focus / Reset view) stays hidden until the block is hovered or
focused.

## Happy paths

- Seed renders both valid diagrams as the `mermaid` kind (bridge CST path) with a
  rendered `<svg>` present in each; the ` ```js ` block stays `fencedCode`
- Edit flow: the Edit button swaps in a textarea seeded with the fence's code;
  changing the code and pressing Ctrl+Enter re-renders and `getSource()` reflects
  the new code byte-exactly inside the same fence
- One undo (Mod+Z) after a commit restores the previous source byte-exactly, both from a
  caret parked elsewhere and from the diagram's own focus surface
- Focus view: the Focus button opens the overlay; Escape closes it (overlay
  presence/absence asserted)
- The `Mod+M` kind-chord opens the focus view when the diagram viewport has focus
  (the minted block-command path)

## User interactions

- Single click on the rendered view focuses the viewport without revealing the
  source; a double click enters edit mode (textarea seeded with the fence code)
- Tab inside the source textarea inserts a tab character at the caret and stays
  in edit mode (Escape, not Tab, is the exit)

## Error cases

- Invalid diagram code renders a legible inline error (never a throw), and the
  editor keeps working — typing in the paragraph below still edits it

## Edge cases

- Escape in the textarea cancels the edit: the code and `getSource()` are unchanged
- A blur commit (clicking another block) persists the edit like Ctrl+Enter
- Round-trip stability after the whole flow: `getSource()` re-parses and
  re-serializes to the same bytes
- A code change landing under an open edit box re-seeds the textarea, and the blur commit
  writes nothing that reverts it (driven at the unit tier, where the live CST is reachable)

## Miss-analysis

The undo bullet above was satisfied by a test that moved focus off the block first, so undo
from the kind's own focus surface — where a keyboard commit leaves it — was never pressed;
the conformance kit's undo column checks entry granularity, never chord reachability from a
focus surface; and no requirement covered an external CST change landing under an open plugin
editing surface at all.
