# Feature: Container Block Editing — Cross-Container Merge on Backspace (blockquote prev)

Backspace at offset 0 of a paragraph following a blockquote merges the paragraph's text into the blockquote's last inner paragraph (or its deepest prose leaf when nested).

## Cross-container merge on Backspace

- Flat blockquote + following paragraph + Backspace at offset 0 of the paragraph: merge the paragraph's text into the blockquote's last inner paragraph. Caret lands at the join point.
- Multi-paragraph blockquote: merge happens into the last inner paragraph only; earlier inner paragraphs are untouched.
- Nested blockquote (`> > deep`): merge recurses into the inner blockquote; the deepest inner paragraph receives the merged text.
- Target is a heading (`> # Heading`): merge into heading raw; kind stays `heading`; text appended after existing heading content.
- Deepest inner leaf is opaque (fenced code, thematic break): fall back to move-focus. No tunneling past opaque leaves. Focus lands inside the opaque leaf, so the next character typed appears there — not in the paragraph the Backspace came from, and not in the container's first child. Source bytes are unchanged by the fallback, so only the typed marker's position can observe it.
- Empty blockquote (all inner children got removed via earlier edits): fall back to move-focus.
- The merged paragraph's text is preserved verbatim including inline markers (`**bold**`, `` `code` ``, etc.).
- One Ctrl+Z after a successful merge restores the pre-merge state (both the target's raw and the deleted paragraph).
