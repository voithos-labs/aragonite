# Feature: cross-block paste over selection — undo / redo

## Happy paths

- Paste 2 blocks over a 3-block selection, Ctrl+Z (restores original and reactivates the pre-paste cross-block selection), Ctrl+Y (re-applies paste). After redo, source matches the post-paste state and the selection is collapsed at the end of the last pasted block (matching where the original paste left the cursor).
- Cross-block top-level multi-block paste is one undo unit: a single Ctrl+Z restores the pre-paste document rather than an intermediate "selection-deleted but blocks-not-inserted" state.
- Cross-block multi-block paste across list items is one undo unit: a single Ctrl+Z restores the pre-paste document.

## Edge cases

- Selection spans a heading → paragraph → paragraph, paste is a single paragraph (inline path): one Ctrl+Z restores heading and both paragraphs; cursor ends up where selection started.
- Paste is a list block into a cross-block prose selection: one Ctrl+Z removes the list and restores the prose.
- Redo stack cleared on any new edit after undo: owned by undo-redo ("redo stack cleared on new edit"), no clipboard ingredient here.

## Regression notes

- Pinned against the closed "undo/redo finicky in cross-block paste + delete scenarios" defect; the redo path is where finickiness lingered.
