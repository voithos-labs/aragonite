# Feature: insert toolbar (consumer insertMarkdown example)

A shared demo component, mounted always by the `/` showcase and behind
`?insertToolbar=on` on `/test/editor` (this spec drives the harness mount;
`showcase-chrome.md` pins the showcase one). Built purely consumer-side:
every construct is a canonical Markdown snippet through `insertMarkdown`, a
plugin's included, so the bar carries no per-construct API. The buttons
cancel their own mousedown default so the caret never leaves the document,
and they grey while the editor holds no caret — the same no-caret decline
`insertMarkdown` answers, read off `selectionChange` ahead of the click.

## Happy paths

- the table button splices the canonical table at the caret, through the same
  paste pipeline a real paste takes
- the rule, code, note and math buttons each land their snippet's bytes in the
  source verbatim

## User interactions

- every button greys before the document holds a caret and enables after a
  real click into a block
- an insert press cancels its own mousedown default, so the caret survives
  the click and the door has a position to insert at (the happy paths fail
  without it: a focus-stealing button makes the door decline)

## Error cases

- zero `[invariant:…]` console fires across the interactions (automatic via
  the shared e2e fixture)
