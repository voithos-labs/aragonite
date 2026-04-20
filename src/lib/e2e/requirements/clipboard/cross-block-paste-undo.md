# Feature: cross-block paste over selection — single Ctrl+Z restores

## Happy paths

- Select across 3 paragraphs, paste 2 paragraphs of content, press Ctrl+Z once: original 3 paragraphs restored exactly, cross-block selection restored.

## Edge cases

- Selection spans a heading → paragraph → paragraph, paste is a single paragraph (inline path): one Ctrl+Z restores heading and both paragraphs; cursor ends up where selection started.
- Paste is a list block into a cross-block prose selection: one Ctrl+Z removes the list and restores the prose.

## Regression notes

- Pinned against the "issues.md: undo/redo finicky in cross-block paste + delete scenarios" entry.
