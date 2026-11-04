# Feature: Report a bug from the showcase

The `/` showcase bar's "report a bug" button records the visitor's input and opens GitHub's bug form with the recording attached. It never files the issue; the visitor reads the form and submits it.

## Happy paths

- Press the button: a card says the recording includes everything typed and the whole document's text, and that a submitted issue is public. Start recording turns the button into "stop and report"; typing, then pressing it, opens `issues/new?template=bug.yml` in a new tab with `where` (version, browser, OS, mode) filled in. The showcase's own document is too long for a link, so the recording (with text) goes on the clipboard, fenced, and the card says to paste it into the form's Recording field. The link fills only `where`: GitHub's form puts a link-filled value back over whatever the visitor pastes.
  Miss-analysis: the link filled the Recording field with an instruction, and no case pasted into the real form.

## User interactions

- Cancel on the card closes it and records nothing; the button reads "report a bug" again.
- Escape closes the card and hands focus back to the button. A press outside leaves it open, so
  a stray click never throws away the privacy note before Start, and an Escape typed in the editor
  is the editor's: the card stays and the editor keeps focus.
  Miss-analysis: the first case pressed Escape with focus in the editor and asserted the card
  closed, so it pinned the focus steal as the contract.

## Edge cases

- On a phone-width screen the card stays inside the viewport: it spans the header with a gutter
  instead of hanging left off the button, which sits too close to the screen's edge for it.
  Miss-analysis: every case ran at the desktop viewport, where the card fits left of the button.

## Error cases

- The browser refuses the clipboard write (focus already moved to the new tab): the card says so and offers Copy recording, whose own click puts the recording on the clipboard.
  Miss-analysis: Firefox can refuse the copy inside `window.open`, before the card is up, and the
  moved card dropped that answer; the move was tested on Chromium only.

## Pinned below the browser

- Even a short recording goes on the clipboard, never the link, and one too long for an issue body downloads as a file instead (`test/debug/bug-report-link.test.ts`).
