# Feature: whole-block atomic copy/cut (focused thematic break)

A focused whole-block-focus block (thematic break here; mermaid pinned separately in
plugins/mermaid-focus) copies its own markdown on Mod+C and cuts it on Mod+X, the
atomic-unit twin of the cross-block sweep-and-copy. Copy is a read and never gates;
cut's delete gates on reading mode.

## Happy paths

- Focused thematic break, Mod+C: clipboard holds the block markdown (`---`); the
  document is unchanged and the block stays focused.
- Focused thematic break, Mod+X: clipboard holds `---`, the block is removed, and one
  Mod+Z restores it byte-exactly.

## Edge cases

- Mod+X undo restores the exact pre-cut source (one undo entry, not a partial).
- Copy does not enter cross-block mode and leaves no selection artifact.

## User interactions

- Arrow into the break from the paragraph above (End then ArrowDown) to focus it, then
  Mod+C / Mod+X — real keyboard focus, no programmatic selection.

## Error / mode cases

- Reading mode, Mod+C: still copies `---` (copy is a read).
- Reading mode, Mod+X: copies `---` but deletes nothing (the delete is reading-gated).
