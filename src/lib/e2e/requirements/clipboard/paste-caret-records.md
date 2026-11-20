# Clipboard: a paste spends the caret memory

What the caret memory holds at the caret, a paste spends as a typed letter spends it, in live mode, whatever the clipboard brings: one line, a line with its line ending, or two paragraphs. A letter typed after the paste follows what was pasted.

## Happy paths

- A held space after a bold run: the pasted text joins the run after the space.
- A pending bold: the pasted text is bold.
- A typed closer: the pasted text lands past the run it closed.
- A chip stop past a code span's edge: the pasted text lands outside the span.
- A chip stop inside a code span's edge: the pasted text lands inside the span.
- A click past the line's end: the pasted text lands past the run, a fresh start.

## Edge cases

- A clipboard's last line ending goes in after the text, past a run the text closed, and the letter typed next takes the empty line it opened.
- Two paragraphs: the first takes the record, the second reopens the run where the record kept it open.
- In a list item or a quote, one line pasted after a held space, a pending bold, a typed closer or a chip stop past a code span takes the record as at the top level, though it commits as a byte splice there, not as the block's own write.
- A line ending pasted mid-item before a hidden run opens the next item as Enter does, and the letter typed next starts plain, before the run. Miss-analysis: the item rows pasted one line, so no row typed after an ending Enter takes.

Miss-analysis: the records were held only by the scratch differential, and a last line ending tried as Enter spent them on a landing that was then thrown away.
