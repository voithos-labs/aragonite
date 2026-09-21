# Feature: Plugin Container, `<details>` Reveal-into-Collapsed, Caret Half

Scrolling to a body child the collapse clamp has unmounted opens the container the way its kind
declares and commits that, so the target mounts instead of dead-ending. This file owns the caret
half of that behavior on the search path: the editor left behind has to be live and editable.
The bytes, the geometry and the undo entry belong to `details-reveal-expand.md`.

The rule that a scroll into a body no scrolling can mount must stop rather than wait for a mount
forever (the VR-5 hang) has unit tests rather than a proof here: the collapse clamp in
`list-windowing-collapse.svelte.test.ts` and the stopping condition in
`reveal-child-or-wait.test.ts`.

## Happy paths

- searching into a collapsed body expands it: with a closed details whose body holds the word
  being searched for, opening search (Ctrl+F) and typing the word finds the match, since the
  scan reaches the unmounted body, and mounts it: `open` lands in the serialized bytes and the
  disclosure reads expanded
- focus returns to the summary: closing search puts the caret back on the summary, and that
  caret is live, so the next keystroke edits the summary

## Edge cases

- the mount is really attempted, not skipped: the search count shows the one match in the body,
  so the expansion runs instead of passing for want of a match

## User interactions

- Ctrl+F, typing the word into the Find field, and Escape are real keyboard and pointer events;
  where the caret ends up is asserted against the tree read by path and against the serialized
  bytes

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty across the
  mount and the edit that follows it
