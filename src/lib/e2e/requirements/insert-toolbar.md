# Feature: insert toolbar (consumer insertMarkdown example)

A shared demo component, mounted always by the `/` showcase and behind
`?insertToolbar=on` on `/test/editor` (this spec drives the harness mount;
`showcase-chrome.md` pins the showcase one). Built purely consumer-side:
every construct is a canonical Markdown snippet through `insertMarkdown`, a
plugin's included, so the bar carries no per-construct API. The buttons
cancel their own mousedown default so the caret never leaves the document,
and they grey while the editor holds no caret, the same refusal
`insertMarkdown` would make with no caret, read off `selectionChange` before the click.

## Happy paths

- the table button splices the canonical table at the caret, through the same
  paste pipeline a real paste takes
- the rule, code, note and math buttons each land their snippet's bytes in the
  source verbatim
- the rule button with the caret after text puts a divider on a line of its own under
  that text, never `---` into it (miss-analysis: the rows checked only that the snippet's
  bytes reached the source, which `start here---` does too)
- the rule button on an empty line makes that line the divider, with no empty line left above
  it (miss-analysis: the rule rows all started after text)

## User interactions

- every button greys before the document holds a caret and enables after a
  real click into a block
- the buttons grey again when focus leaves the editor for the host's own controls: the
  editor announces the departure on `selectionChange` even though the browser's
  range survives unfocused (miss-analysis: the greying was only ever tested on
  the way to enabled, so the event's silence when the user blurs went unobserved)
- a click on an insert button cancels its own mousedown default, so the caret survives
  the click and `insertMarkdown` has a position to insert at (the happy paths fail
  without it: a button that steals focus makes the call decline)

## Error cases

- zero `[invariant:…]` console fires across the interactions (automatic via
  the shared e2e fixture)
