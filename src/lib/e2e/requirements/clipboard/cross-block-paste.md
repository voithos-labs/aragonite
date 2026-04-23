# Feature: cross-block clipboard — paste basics and multi-block paste at single caret

## Happy paths

- Ctrl+V with cross-block selection deletes the range then pastes clipboard content.
- Pasting two paragraphs at a single caret creates multiple top-level blocks.
- Multi-block paste with an active intra-block selection replaces the selected text with the pasted blocks.

## Edge cases

- Multi-block paste over an intra-block selection is one undo unit: a single Ctrl+Z restores the pre-paste document.
