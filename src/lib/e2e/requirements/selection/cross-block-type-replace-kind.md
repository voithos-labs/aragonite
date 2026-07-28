# Feature: Cross-block type-replace re-derives the survivor's kind

Typing a character over a cross-block selection deletes the range, then splices the
character into the surviving leaf's raw. When the collapse lands at offset 0 and the
typed character is a block marker, the survivor's kind must be re-derived inside the
commit — parity with the single-block type path, which re-parses. Before the fix the
raw was spliced with the kind held stale until the next full re-parse: the source
read `#…` while the block still rendered and classified as a paragraph.

## Happy paths

- Two top-level paragraphs, select both whole (collapse empties the survivor at
  offset 0), type `#`: the survivor re-parses to a heading — CST kind `heading`,
  the block wrapper carries `data-block-kind="heading"`, and the source is `#`.

## Edge cases

- Nested survivor: a blockquote paragraph selected out through a following
  paragraph, collapse landing inside the blockquote at offset 0, type `>`: the
  surviving blockquote child re-parses to a nested blockquote (kind `blockquote`),
  proving the container-scope commit path re-derives the kind and rebuilds the
  ancestor raw — not only the top-level doc-scope path.
