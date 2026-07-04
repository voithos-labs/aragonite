# Clipboard Exploration: Paste Materializes Blank Lines

When pasting multi-block content with blank-line separators, the pasted CST structure must match what keyboard typing produces for the same content — so the rendered DOM shows the same visible blank lines either way.

Same serialized source (`"one\n\ntwo\n"`), same rendered result (three DOM blocks: `one`, empty paragraph, `two`).

## Happy paths

- Typing `"one Enter Enter two"` → produces 3 DOM blocks.
- Pasting `"one\n\ntwo"` (clipboard) → produces 3 DOM blocks, matching the typed scenario.

## Edge cases

- Multiple blank lines on clipboard: each `\n` in leadingTrivia materializes one additional empty paragraph.
- Pasted content with non-blank-separated adjacent blocks (trivia empty): retains existing block-separation behavior (no extra empty paragraphs inserted).

## Caret placement

- Pasting multi-block content into the MIDDLE of a non-empty paragraph lands the caret at the end of the PASTED content, not the trailing residue that sat after the caret. Typing immediately after the paste appends to the pasted content (end-of-block pastes, which have no residue, are unchanged).
