# Clipboard: a pasted blank line is the block a typed or loaded one is

Paste parses the clipboard, so blank lines on it follow the parser's rule and nothing else: in a run of blank lines the first separates and every later one is an empty-paragraph block. The same bytes therefore render the same blocks whether they are typed, loaded, or pasted — the divergence tracked as issue #20, where structural paste minted an extra empty row per separator.

## Happy paths

- Typing `"one Enter Enter two"` → `"one\n\n\ntwo\n"`, 3 DOM blocks: the second press creates the empty block, whose own line is the third newline. Loading those bytes gives the same 3.
- Pasting `"one\n\ntwo"` (clipboard) → 2 DOM blocks, the same count loading those bytes gives: a lone blank line separates and mints nothing.
- Pasting `"one\n\n\ntwo"` → 3 DOM blocks, the middle one empty: a blank run past its first line crosses the clipboard as a real block.

## Edge cases

- CRLF: a Windows clipboard writes `\r\n`, which is blank the same way `\n` is, so the block counts do not change with the line ending.
- Pasted content with non-blank-separated adjacent blocks (trivia empty): retains existing block-separation behavior (no empty paragraphs inserted).

## Caret placement

- Pasting multi-block content into the MIDDLE of a non-empty paragraph lands the caret at the end of the PASTED content, not the trailing residue that sat after the caret. Typing immediately after the paste appends to the pasted content (end-of-block pastes, which have no residue, are unchanged). This holds when the residue reads as a continuation of the last pasted block and the splice settle folds the two into one, where "end of the pasted content" is an offset inside that folded block rather than its end.
