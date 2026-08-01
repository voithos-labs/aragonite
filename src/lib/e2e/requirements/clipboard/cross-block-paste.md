# Feature: cross-block clipboard — paste basics and multi-block paste at single caret

## Happy paths

- Ctrl+V with cross-block selection deletes the range then pastes clipboard content.
- Pasting two paragraphs at a single caret creates multiple top-level blocks.
- Multi-block paste with an active intra-block selection replaces the selected text with the pasted blocks.

## Edge cases

- Multi-block paste over an intra-block selection is one undo unit: a single Ctrl+Z restores the pre-paste document.
- A clipboard whose blocks are blank-line separated pastes to the blocks those bytes reparse to (see paste-blank-line-parity): a lone blank line separates and mints no row. Pasting `# Heading` / blank / `New paragraph` at the end of a paragraph yields three blocks, and the live-CST count equals the reparse count.
- An end-of-block paste appends no trailing residue, and a start-of-block paste mints no leading node: neither position produces an empty-raw phantom block.
