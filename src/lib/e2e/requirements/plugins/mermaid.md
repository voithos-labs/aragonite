# Feature: Mermaid diagram block — render-primary reference plugin

A ` ```mermaid ` fence claims a childless plugin container whose code lives in metadata;
the component renders the diagram SVG through an injected renderer, with a
plugin-owned textarea edit mode committing through `updateOwnMetadata` as one
undoable entry, pan/zoom on the rendered SVG, and a fixed-position focus overlay.
The block opts out of caret traversal (mouse + commands reach it); a plain fence
with any other info string must stay the built-in `fencedCode`.

## Happy paths

- Seed renders both valid diagrams as the `mermaid` kind (bridge CST path) with a
  rendered `<svg>` present in each; the ` ```js ` block stays `fencedCode`
- Edit flow: the Edit button swaps in a textarea seeded with the fence's code;
  changing the code and pressing Ctrl+Enter re-renders and `getSource()` reflects
  the new code byte-exactly inside the same fence
- One undo (Mod+Z) after a commit restores the previous source byte-exactly
- Focus view: the Focus button opens the overlay; Escape closes it (overlay
  presence/absence asserted)
- The `Mod+M` kind-chord opens the focus view when the diagram viewport has focus
  (the minted block-command path)

## Error cases

- Invalid diagram code renders a legible inline error (never a throw), and the
  editor keeps working — typing in the paragraph below still edits it

## Edge cases

- Escape in the textarea cancels the edit: the code and `getSource()` are unchanged
- A blur commit (clicking another block) persists the edit like Ctrl+Enter
- Round-trip stability after the whole flow: `getSource()` re-parses and
  re-serializes to the same bytes
