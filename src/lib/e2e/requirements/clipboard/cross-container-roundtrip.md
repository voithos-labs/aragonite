# Clipboard: Cross-Container Round-Trip

Copy + paste across container boundaries. Catches asymmetries between the copy-side serialization and the paste-side parsing.

## Happy paths

- Copy from blockquote inner paragraph → paste into top-level paragraph: content concatenates, blockquote stays intact.
- Copy top-level paragraph → paste into blockquote inner paragraph: content lands inside the blockquote.
- Copy cross-container range (blockquote → top-level paragraph) → paste into fresh document: both selected pieces arrive.

## Cut pasted back in place

A cut, then a paste at the caret it left, gives the document back: two paragraphs, a paragraph
into a nested quote, a quote out to a paragraph, a list item out to a paragraph. The copy half
holds; the paste half doesn't join its first and last blocks to the text around the caret yet
(#818), so these rows are marked to fail until it does.
