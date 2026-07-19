# Feature: Merge gesture reachability (note-taking simulation)

Reachability self-tests for the Backspace-at-start merge gesture the corruption
oracle uses. Each drives the gesture on a fixed document and asserts a real merge or
container-exit unwrap happened — so a Backspace that no-oped can never pass as
coverage inside a full session. Isolated (no `runSession`): the gesture is exercised
directly against a controlled fixture.

## Happy paths — merge

- para→para: Backspace at the second block's start merges it into the first, dropping
  a top-level block
- para→heading (absorber): the paragraph is absorbed and the heading stays a heading
- para→list: the paragraph merges into the preceding list, dropping a top-level block

## Happy paths — container exit

- list U1: Backspace at the first list item's start unwraps it to a plain paragraph
  while later items stay in the list
- blockquote U2: Backspace at the first line's start lifts it out of the quote

## Error cases

- Backspace at the document's first block (no predecessor) fails loudly rather than
  recording an unchanged tree as a merge
