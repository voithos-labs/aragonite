# Feature: A plugin-registered command: callout.setKind

The `:::callout` callout registers a `callout.setKind` block command on the public
`@voithos-labs/aragonite/plugin` API and binds it to two chords that carry an argument, in the
callout descriptor's `keymap`. It is the end-to-end proof for plugin-registered commands: a real
keypress on an inner leaf is declined there without `preventDefault`, bubbles to the container's
`handleKeydown`, resolves against the callout kind's keymap, runs the registered handler, and
commits the new type through the container's metadata update (`rebuildCalloutRaw`, then the
existing `metadataUpdate` op). No new op kind. The checks read behavior: they read the tree and
the source through `window.__test`, never visuals.

The bound chords are `Mod+7` (argument `'callout'`) and `Mod+8` (argument `'aside'`). The
obvious `Mod+Shift+1/2` does not work, because the browser translates a Shift-held digit's key
token (`'1'` becomes `'!'`) and no digit binding can match that; the Shift-free `Mod+7/8` sit
past the `Mod+0–6` heading range and survive a real keypress.

## Happy paths

- chord from body sets the type: with the caret in the callout's body paragraph, `Mod+8`
  rewrites the opener to `:::aside` and the source round-trips stable
- the second argument travels its own binding: on a `:::aside` callout, `Mod+7` sets it back to
  `:::callout`, which is how we know the descriptor's `unknown` argument carries each string

## Edge cases

- exactly one edit event: the type change fires a single `metadataUpdate` op and nothing else
  (no split, no input op), the same event the checkbox toggle emits
- undo restores the prior type: after `Mod+8` sets `:::aside`, one `Ctrl+Z` returns the source
  to `:::callout`
- a non-string argument does nothing: the handler type-guards `ctx.arg` and declines any value
  that is not a string. Both bound chords carry strings, so no keyboard route reaches this here;
  the handler's own shape covers it instead of an e2e test

## User interactions

- click or focus the callout body, then press `Mod+8`: a real keypress on the body leaf bubbles
  to the container and commits the type, asserted against the source
- focus the reserved `callout-title` leaf (child 0), then press `Mod+8`: the chord bubbles from
  that leaf too, so the container handler is reached from both editable areas inside the
  callout, not just the body
- `Ctrl+Z` is a real keystroke; the restored source is asserted, not the DOM
