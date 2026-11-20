# Clipboard: a multi-block paste at the start of a heading's text

Pasting several blocks with the caret right before a heading's text cuts the heading there as a split does. The heading's marker and its closing run stay on the first half, so the first pasted block becomes the heading, and the heading's old text joins the last pasted block.

## Happy paths

- `# Hi`, live mode, End then Home (the caret sits before `Hi`, the `# ` hidden), paste `abc\n\ndef`: the source is `# abc\n\ndefHi\n`, and a reload reads the same tree.
- The same with a closing run, `# Hi #`: the source is `# abc #\n\ndefHi\n`, the closing run on the first half with the marker.

## Undo

- One Ctrl+Z after that paste gives back `# Hi\n`.

## Miss-analysis

- GH #623: every head-of-text paste row cut a setext title, whose text starts at 0, so nothing cut an ATX heading between its marker and its text, where the paste left an empty `# ` heading behind and live mode cleared it in a second undo step.
