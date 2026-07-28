# Feature: Plugin Container — `<details>` Reveal-into-Collapsed, Caret Half

A reveal targeting a body child the collapse clamp has unmounted opens the kind's
declared expand door and commits it, so the target mounts instead of dead-ending.
This file owns the CARET half of that behavior on the search path: the reveal must
leave a live, editable editor behind it. The bytes, the geometry, and the undo
entry are owned by `details-reveal-expand.md`.

The no-hang seam (a reveal into a body no scroll can mount must terminate rather
than await a mount forever — the VR-5 hang) is unit-covered, not proven here: the
collapse clamp in `list-windowing-collapse.svelte.test.ts` and reveal termination in
`reveal-child-or-wait.test.ts`.

## Happy paths

- search into a collapsed body expands it: with a closed details whose body holds a
  needle, opening search (Ctrl+F) and typing the needle finds the match (the scan
  reaches the unmounted body) and the reveal mounts it — `open` lands in the
  serialized bytes and the disclosure reads expanded
- focus returns to the summary: closing search lands the caret back on the summary,
  and that caret is live (a subsequent keystroke edits the summary)

## Edge cases

- the reveal is genuinely attempted, not skipped: the search count shows the single
  body match, so the expansion is exercised rather than vacuously passing on no match

## User interactions

- Ctrl+F, typing the needle into the Find field, and Escape are real keyboard and
  pointer events; the caret landing is asserted against the CST by path and the
  serialized bytes

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty
  across the reveal and the post-reveal edit
