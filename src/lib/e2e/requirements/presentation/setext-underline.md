# Feature: a setext heading's underline on screen

A setext heading keeps its structure in the underline below its title (`===` or `---`). The page
draws it as a marker after the title: source mode shows it on its own line, where the caret can go
to change or delete it like any other marker, and live mode hides it, where the title's end is the
block's end for the caret. Driven on `/test/editor` with `?presentationMode=` and real keys.

Miss-analysis: no mode drew the underline, so every scenario treated the title's end as the
block's end, and none asked what source mode shows (GH #463), how the caret crosses the underline
line, or what a hard break at the title's end writes (GH #468).

## Happy paths

- source mode shows the underline under the title; live mode shows the title alone

A unit test covers Shift+Enter at the title's end (GH #468), in both modes:
`src/lib/test/blocks/text/setext-underline-drawn.test.ts` checks it writes nothing yet, and that
the next key starts the heading's second line above the underline (`Plan\` over `x` over `===`).

## Edge cases

- source mode: ArrowDown from the title stops on the underline's line, and a second ArrowDown
  leaves the heading, as a code block's closer line takes a press of its own
- live mode: ArrowDown from the title leaves the heading in one press
- ArrowUp from the block below enters the heading: onto the underline's line in source mode, onto
  the title in live mode

- source mode: a click at the middle of the heading lands on the underline's line (the block is
  two lines there), so End then a key writes after the underline (`Plan` over `---s`) and the
  block reads as a paragraph

## User interactions

- a placed caret or a real click, then real arrow keys, End and a typed key

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
