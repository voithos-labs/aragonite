# Feature: deleting the rule between a paragraph and indented code

With a thematic break between a paragraph and an indented code block, Delete at the paragraph's
end focuses the break and a second Delete removes it. The indented line then reads as the
paragraph's continuation, and the whitespace lines the code held become blank lines of their own.
Only the break's bytes may leave the file, and the editor's blocks must match what a reload of
the same bytes reads.

Miss-analysis: the one unit pin on this join encoded the lost blank line as known, and no case
gave the code more whitespace lines than the join had blocks to hold them.

## Happy paths

- two whitespace lines under the code, then a blank line and a fence: the source loses the break's line and nothing else, and the tree matches a reload (#450)

## Edge cases

- three whitespace lines under the code: the same, where the join reads as more blocks than it replaced (#451)

## User interactions

- a real click on the paragraph, End, then Delete twice

## Error cases

- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)
