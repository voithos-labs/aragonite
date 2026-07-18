# Feature: Cross-block gesture reachability (note-taking simulation)

Reachability self-tests for the cross-block gesture family the corruption oracle
uses. Each drives one gesture on a fixed document and asserts, through the bridge,
that the dangerous state it claims to reach actually engaged — so a build that
silently stayed single-block, or a destroy that no-oped, can never pass as coverage
inside a full session. Isolated (no `runSession`): a gesture is exercised directly
against a controlled fixture.

## Happy paths — build

- Shift+ArrowDown across the block boundary engages a real cross-block selection
- Shift+Click into another block engages a cross-block selection
- double Ctrl+A escalates from the caret's block to a whole-document selection whose
  endpoints span the first and last block

## Happy paths — destroy

- Backspace and Delete each collapse the cross-block range: the source changes and the
  cross-block state clears
- Cut collapses the range and removes the covered text
- type-over collapses the range and inserts the typed character
- paste-over collapses the range and replaces it with the clipboard payload

## Error cases

- a build that cannot cross (single-block document) fails loudly rather than recording
  a stale single-block selection as a cross-block one
