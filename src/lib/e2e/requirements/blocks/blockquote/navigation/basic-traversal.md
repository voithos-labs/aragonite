# Feature: Blockquote Navigation — Basic Traversal

Baseline ArrowUp/Down navigation across blockquote inner paragraphs and across blockquote/outer-block boundaries, without any prior structural edits.

## Basic traversal

- ArrowDown from first inner paragraph lands on second inner paragraph
- ArrowUp from second inner paragraph lands on first inner paragraph
- ArrowDown from the last inner paragraph exits the blockquote to the next top-level block
- ArrowUp from the first inner paragraph exits the blockquote to the previous top-level block
- ArrowDown from a paragraph before the blockquote enters the blockquote's first inner paragraph
- ArrowUp from a paragraph after the blockquote enters the blockquote's last inner paragraph
