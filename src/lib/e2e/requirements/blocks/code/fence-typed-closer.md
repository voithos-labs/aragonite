# Feature: typing the closer of an open code fence

A fenced code block with no closer yet runs to the end of the document. Typing its closer one
backtick at a time has to write exactly those backticks: the fence write rule grows a fence past a
body line that reads as its closer when the bytes arrive whole (a paste, a replace), and the same
rule applied to the first typed backticks would grow the opener instead and leave the fence
impossible to close by typing. Driven on `/test/editor` with real keys, in source and live mode.

Miss-analysis: the rule's own tests passed its mode by hand, and the one typing path that ran it
applied it inside the code block itself, so nothing typed through the content write the rule now
runs at.

## Happy paths

- an open fence (` ```js ` over `code`, nothing after it), Enter at the body end, then three
  backticks typed one at a time, in source and live mode: each backtick lands as typed, and the
  third closes the block, whose bytes are ` ```js\ncode\n```\n `

## Edge cases

- the block is a fenced code block before and after the closer is typed

## User interactions

- a placed caret at the body end, a real Enter, then real key presses one backtick at a time

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
