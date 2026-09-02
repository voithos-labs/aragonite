# Feature: the party parrot block

A `%%parrot` line renders as an animated ASCII party parrot with the bytes after the
marker as its caption. The line itself stays an always-editable plain leaf below the
bird, so the caption is the source and the source is the caption. Seed `parrot`: block 0
`%%parrot party responsibly`, block 1 `After` (a plain caret and blur target).

## Happy paths

- Seed render: block 0 shows one `.parrot-block` holding a `pre.parrot` frame and a
  `.parrot-caption` reading `party responsibly`; the `%%parrot party responsibly` bytes
  stay in the source.
- The bird dances: the `pre.parrot` text changes on its own, with no gesture — two
  samples taken across a wait differ.

## User interactions

- Typing extends the caption: with the caret at the end of the source line, typed
  characters land in the source bytes and the rendered caption follows them live.
- Deleting back to the bare marker drops the caption element entirely; the block stays a
  parrot and the frame keeps dancing.
- Arrow out: from the end of the parrot's source line, ArrowRight lands the caret in the
  following paragraph — the leaf is a caret stop like any other block.

## Edge cases

- Round-trip after editing: the document `getSource()` returns is exactly the seed with
  the typed bytes in it, marker included — the parrot's chrome writes no bytes of its own.

## Error cases

- Uninstalled parity is a unit concern (`test/plugins/parrot/round-trip.test.ts`): with
  the plugin absent, `%%parrot …` is an ordinary paragraph. The e2e runs only with the
  plugin installed and asserts no console errors are captured across every gesture.
