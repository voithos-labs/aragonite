# Feature: insertMarkdown — the decline gates

The door inserts where a paste would and nowhere else. A decline returns `false`
and mutates nothing: no commit, no undo entry, no source change.

Every decline carries a positive control in the same fixture: the same call and the same
payload succeed once that one condition lifts. Without it a door broken outright reads as
three passing gates.

## Error cases

- Nothing focused in this editor: there is no caret to insert at, so the call returns
  `false` and the source is unchanged.
- Reading mode: the surface is inert and paste is a no-op, so the door declines too.
- A parked gap caret (between two blocks): the gap takes no payload, so the door declines
  rather than guessing a neighbouring block.

## Happy paths (the controls)

- Focus returned to the previously-blurred block: the same payload inserts.
- Editing mode restored and a caret placed: the same payload inserts.
- The caret moved off the gap into a real block (a real exit gesture; the gap only clears at the caret doors): the same payload inserts.
