# Clipboard Exploration: Cross-Container Round-Trip

Copy + paste across container boundaries. Catches asymmetries between the copy-side serialization and the paste-side parsing.

## Happy paths

- Copy from blockquote inner paragraph → paste into top-level paragraph: content concatenates, blockquote stays intact.
- Copy top-level paragraph → paste into blockquote inner paragraph: content lands inside the blockquote.
- Copy cross-container range (blockquote → top-level paragraph) → paste into fresh document: both selected pieces arrive.
