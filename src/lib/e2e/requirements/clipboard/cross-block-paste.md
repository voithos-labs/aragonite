# Feature: cross-block clipboard — paste basics, multi-block paste, structural discriminator

## Happy paths

- Ctrl+V with cross-block selection deletes the range then pastes clipboard content.
- Pasting two paragraphs at a single caret creates multiple top-level blocks.
- Multi-block paste with an active intra-block selection replaces the selected text with the pasted blocks.
- Pasting a markdown list at the end of a paragraph creates a list block below the paragraph with no items dropped.
- Pasting a markdown list inside a list item preserves all pasted items alongside the original items.
- Pasting a heading at the end of a paragraph creates a heading block below the paragraph.

## Edge cases

- Multi-block paste over an intra-block selection is one undo unit: a single Ctrl+Z restores the pre-paste document.
- A clipboard whose blocks are blank-line separated pastes to the blocks those bytes reparse to (see paste-blank-line-parity): a lone blank line separates and mints no row. Pasting `# Heading` / blank / `New paragraph` at the end of a paragraph yields three blocks, and the live-CST count equals the reparse count.
- An end-of-block paste appends no trailing residue, and a start-of-block paste mints no leading node: neither position produces an empty-raw phantom block.
- Multi-block paste into a cross-list-item selection is covered in cross-block-paste-list (its multi-block and untouched-tail scenarios).
