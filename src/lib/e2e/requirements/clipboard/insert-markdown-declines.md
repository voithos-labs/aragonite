# Feature: insertMarkdown, the decline gates

The method inserts where a paste would and nowhere else. A decline returns `false`
and mutates nothing: no commit, no undo entry, no source change.

Every decline carries a positive control in the same fixture: the same call and the same
payload succeed once that one condition lifts. Without it, a method broken outright reads
as three passing checks.

## Error cases

- Nothing focused in this editor: there is no caret to insert at, so the call returns
  `false` and the source is unchanged.
- Reading mode: the block is inert and paste does nothing, so the call declines too.
- A gap caret resting between two blocks: the gap takes no content, so the call declines
  rather than guessing a neighbouring block.

## Happy paths (the controls)

- Focus returned to the previously-blurred block: the same payload inserts.
- Editing mode restored and a caret placed: the same payload inserts.
- The caret moved off the gap into a real block (a real exit gesture; the gap only clears at the caret entry points): the same payload inserts.
