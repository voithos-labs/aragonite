# Feature: Forward-Delete at code-block closer exit

Forward-Delete with the caret at a fenced code block's closer boundary (`exitNext`)
moves focus to the next block when one exists, and is a true no-op at the document
end. The "next block" is the next sibling in the container or, when the code block is
its container's last child, the parent's next sibling reached by upward delegation —
never a freshly appended trailing paragraph.

## Edge cases

- root code block followed by a paragraph: Delete at the closer moves focus to the paragraph; no block is appended
- nested code block as a blockquote's only child, paragraph follows at root: the fence ends the container, so Delete at the closer parks in the blockquote's scope-end gap (requirements/selection/gap-caret-arrival.md); a second Delete delegates out and lands on the root paragraph; no block is appended
- nested code block as a blockquote's only child at the true document end: Delete at the closer parks in the blockquote's scope-end gap and mutates nothing; no trailing paragraph is appended (regression for the container-local-index vs root-child-count mismatch)
- nested code block with a sibling paragraph inside the same blockquote: Delete at the closer moves focus to the sibling paragraph within the blockquote; no block is appended (regression for the no-op-when-a-next-sibling-exists mismatch)
