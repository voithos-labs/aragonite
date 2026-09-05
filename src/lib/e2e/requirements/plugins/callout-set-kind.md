# Feature: Plugin Command Mint — callout.setKind

The `:::callout` callout mints a `callout.setKind` block-command on the public
`@voithos-labs/aragonite/plugin` seam and binds it to two arg-bearing chords on the callout
descriptor's `keymap`. This is the command-mint batch's dogfood driver: it proves
the whole chain end-to-end — a real keypress on an inner leaf, declined there
without `preventDefault`, bubbles to the container's `handleKeydown`, resolves
against the callout kind's keymap, runs the registered handler, and commits the new
type through the container's metadata seam (→ `rebuildCalloutRaw` → the existing
`metadataUpdate` op). No new op kind. The gate is behavioral: it reads the CST /
source through `window.__test`, never visuals.

The bound chords are `Mod+7` (arg `'callout'`) and `Mod+8` (arg `'aside'`), chosen
over the intuitive `Mod+Shift+1/2` because a Shift-held digit's key token is
browser-translated (`'1'`→`'!'`), which no digit binding can match; the Shift-free
`Mod+7/8` sit past the `Mod+0–6` heading range and round-trip a real keypress.

## Happy paths

- chord from body sets the type: with the caret in the callout's body paragraph,
  `Mod+8` rewrites the opener to `:::aside` and the source round-trips stable
- second arg travels its own binding: on a `:::aside` callout, `Mod+7` sets it
  back to `:::callout` — proving the descriptor's `unknown` arg carries each string

## Edge cases

- exactly one edit event: the type-change fires a single `metadataUpdate` op and
  nothing else (no split, no input op) — the same event the checkbox toggle emits
- undo restores the prior type: after `Mod+8` sets `:::aside`, one `Ctrl+Z`
  returns the source to `:::callout`
- non-string arg is a no-op: the handler type-guards `ctx.arg` and declines a
  non-string value. Both bound chords carry strings, so this path is not reachable
  by keyboard here — it is covered by construction in the handler, not e2e'd

## User interactions

- click/focus the callout body, press `Mod+8`: a real keypress on the body leaf
  bubbles to the container and commits the type — asserted against the source
- focus the reserved `callout-title` chrome (child 0), press `Mod+8`: the chord
  bubbles from the chrome leaf too, proving the container handler is reached from
  both inner surfaces, not just the body
- `Ctrl+Z` is a real keystroke; the restored source is asserted, not the DOM
