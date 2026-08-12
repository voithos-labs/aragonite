# Feature: insertMarkdown — the decline gates

The door inserts where a paste would and nowhere else. A decline returns `false`
and mutates nothing: no commit, no undo entry, no source change.

## Error cases

- Nothing focused in this editor: there is no caret to insert at, so the call returns
  `false` and the source is unchanged.
- Reading mode: the surface is inert and paste is a no-op, so the door declines too.
- A parked gap caret (between two blocks): the gap takes no payload, so the door declines
  rather than guessing a neighbouring block.
