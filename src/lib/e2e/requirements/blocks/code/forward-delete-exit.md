# Feature: Forward-Delete at code-block closer exit

Forward-Delete with the caret at a fenced code block's closer boundary (`exitNext`)
moves focus to the next block when one exists, and does nothing at all at the document
end. The "next block" is the next sibling in the container or, when the code block is
its container's last child, the parent's next sibling reached by delegating upward,
never a trailing paragraph appended for the occasion.

## Edge cases

- root code block followed by a paragraph: Delete at the closer moves focus to the paragraph; no block is appended
- nested code block as a blockquote's only child, paragraph follows at root: the fence ends the container, so Delete at the closer puts the caret in the gap at the end of the blockquote's children (requirements/selection/gap-caret-arrival.md); a second Delete delegates out and lands on the root paragraph; no block is appended
- nested code block as a blockquote's only child at the true document end: Delete at the closer puts the caret in that same end gap and changes nothing; no trailing paragraph is appended (a regression test for comparing an index inside the container against the root's child count)
- nested code block with a sibling paragraph inside the same blockquote: Delete at the closer moves focus to the sibling paragraph within the blockquote; no block is appended (a regression test for doing nothing while a next sibling does exist)
