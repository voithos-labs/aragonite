# Clipboard: a multi-block paste at the start of a heading's text

Pasting several blocks with the caret right before a heading's text puts the blocks above the heading. The `# ` stays with the heading's text, the same way Enter there moves the whole heading down a line.

## Happy paths

- `# Hi`, live mode, End then Home (the caret sits before `Hi`, the `# ` hidden), paste `abc\n\ndef`: the source is `abc\n\ndef\n# Hi\n`, and a reload reads the same tree.
- The same with a closing run, `# Hi #`: the source is `abc\n\ndef\n# Hi #\n`, closing run and all.

## Undo

- One Ctrl+Z after that paste gives back `# Hi\n`.

## Miss-analysis

- GH #623: every head-of-text paste row cut a setext title, whose text starts at 0, so nothing cut an ATX heading between its marker and its text, where the paste left an empty `# ` heading behind and live mode cleared it in a second undo step.
