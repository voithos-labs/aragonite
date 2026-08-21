# Presentation-mode strip capture

Regenerates `docs/assets/presentation-modes.png`, the README's side-by-side of three presentation
modes. Not a behavioural test: what it asserts is what the published image shows, so the bullets
below are the picture's contract.

## The panels

- three panels, left to right: source, preview-inline, live, over one shared note
- the note carries a heading, bold, italic, a task list, inline code and a blockquote, so every
  marker family appears in the source panel
- every panel is captured from a real editor at `/test/editor`, never hand-composed, so the image
  cannot drift from the modes

## Caret placement

- the preview-inline panel holds the caret inside the bold word, so that construct's markers reveal
  while the rest of the document's stay hidden
- the live panel holds the caret in the same word, and its markers stay hidden anyway — the paired
  caret is the strip's whole argument
- the source panel needs no caret: every marker is painted regardless of where the caret sits
- each panel is a separate page load, because one document can hold one focus

## Presentation

- drag handles are off in every panel, so a hover affordance cannot read as a difference between modes
- the pointer is parked away from the text before each shot
- panels are cropped to one common height, since hidden markers reflow the text and natural heights differ
- each caption names the mode and where the caret is

## Failure cases

- the caret never lands (the word sits below the fold): the run fails rather than publishing a panel
  whose reveal state misrepresents the mode
