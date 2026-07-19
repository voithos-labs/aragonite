# Feature: cross-block clipboard — paste basics and multi-block paste at single caret

## Happy paths

- Ctrl+V with cross-block selection deletes the range then pastes clipboard content.
- Pasting two paragraphs at a single caret creates multiple top-level blocks.
- Multi-block paste with an active intra-block selection replaces the selected text with the pasted blocks.

## Edge cases

- Multi-block paste over an intra-block selection is one undo unit: a single Ctrl+Z restores the pre-paste document.
- A clipboard whose blocks are blank-line separated materializes each blank line as a real empty-paragraph row (see paste-materializes-blank-lines), so the live-CST block count includes those rows — it is not the reparse count, which folds the blank lines back into trivia. Pasting `# Heading` / blank / `New paragraph` at the end of a paragraph yields four blocks.
- An end-of-block paste appends no trailing residue, and a start-of-block paste mints no leading node: neither position produces an empty-raw phantom block.
