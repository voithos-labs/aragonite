# Feature: Plugin Container — `<details>` Reveal-into-Collapsed Degrade

Spec §4's reveal rule: a reveal/focus operation targeting a body child that the
collapse clamp has unmounted must degrade to the summary WITHOUT mutating the
document. Auto-expand is rejected — `open` is serialized bytes, so expanding on
mere reveal (e.g. search navigation) would edit the document. The no-hang seam (a
reveal into a body the clamp can never mount must terminate rather than await a
mount forever — the VR-5 hang) is unit-covered, not proven here: the collapse clamp
in `list-windowing-collapse.svelte.test.ts` and reveal termination in
`reveal-child-or-wait.test.ts`. This gate stays green with the `isInWindow` clamp
neutered (the render-window and `revealChild` clamps enforce its assertions), so it
proves the OBSERVABLE, non-mutating degrade on the real search path — not the
no-hang.

## Happy paths

- search into a collapsed body degrades: with a closed details whose body holds a
  needle, opening search (Ctrl+F) and typing the needle finds the match (the scan
  reaches the unmounted body) but the reveal neither mounts the body nor flips
  `open` — the summary stays the sole mounted, accessible surface
- non-mutating: after the reveal the serialized bytes are byte-identical (`<details>`
  stays closed, `aria-expanded` stays false) — reveal never edits the document
- focus returns to the summary: closing search lands the caret back on the summary,
  and that caret is live (a subsequent keystroke edits the summary)

## Edge cases

- the reveal is genuinely attempted, not skipped: the search count shows the single
  body match, so the degrade is exercised rather than vacuously passing on no match

## User interactions

- Ctrl+F, typing the needle into the Find field, and Escape are real keyboard and
  pointer events; the caret landing is asserted against the CST by path and the
  serialized bytes

## Error cases

- the `[invariant:…]` console watcher stays silent and `getCapturedErrors()` is empty
  across the reveal and the post-degrade edit
