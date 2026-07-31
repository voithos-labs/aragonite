# Clipboard Exploration: Paste Materializes Blank Lines

Pasting multi-block content materializes each blank-line separator into an empty-paragraph block, so the blank line is visible in the rendered DOM.

That is one block wider than the same bytes reach any other way. Enter separates, so typing `one Enter two` produces `"one\n\ntwo\n"` as TWO blocks — the blank line is trivia — which is also how the parser loads it. The paste divergence is tracked as issue #20.

## Happy paths

- Typing `"one Enter Enter two"` → `"one\n\n\ntwo\n"`, 3 DOM blocks: the second press creates the empty block, whose own line is the third newline.
- Pasting `"one\n\ntwo"` (clipboard) → 3 DOM blocks.

## Edge cases

- Multiple blank lines on clipboard: each `\n` in leadingTrivia materializes one additional empty paragraph.
- Pasted content with non-blank-separated adjacent blocks (trivia empty): retains existing block-separation behavior (no extra empty paragraphs inserted).

## Caret placement

- Pasting multi-block content into the MIDDLE of a non-empty paragraph lands the caret at the end of the PASTED content, not the trailing residue that sat after the caret. Typing immediately after the paste appends to the pasted content (end-of-block pastes, which have no residue, are unchanged).
