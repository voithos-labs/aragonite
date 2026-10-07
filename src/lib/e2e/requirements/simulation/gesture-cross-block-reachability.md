# Feature: Cross-block gesture reachability (note-taking simulation)

Self-tests that every cross-block gesture the corruption checks use can actually
reach the state it claims. Each drives one gesture on a fixed document and asserts,
through the test bridge, that the dangerous state really engaged, so a build that
silently stayed inside one block, or a destroy that did nothing, can never pass as
coverage inside a full session. These run on their own (no `runSession`): the gesture
is driven directly against a controlled fixture.

## Happy paths: build

- Shift+ArrowDown across the block boundary engages a real cross-block selection
- Shift+Click into another block engages a cross-block selection
- double Ctrl+A escalates from the caret's block to a whole-document selection whose
  endpoints span the first and last block

## Happy paths: destroy

- Backspace and Delete each collapse the cross-block range: the source changes and the
  cross-block state clears
- Cut collapses the range and removes the covered text
- type-over collapses the range and inserts the typed character
- paste-over collapses the range and replaces it with the clipboard's contents: the
  two halves join around the pasted text (`alCLIPta`). Miss-analysis: the fixture's
  third block is the clipboard text itself, so checking that the source holds `CLIP`
  passed even when the gesture pressed Delete and pasted nothing.
- an IME composition over the range replaces the covered text with the composed text,
  and one Ctrl+Z brings the source back

## Error cases

- a build that cannot cross (single-block document) fails loudly rather than recording
  a stale single-block selection as a cross-block one
