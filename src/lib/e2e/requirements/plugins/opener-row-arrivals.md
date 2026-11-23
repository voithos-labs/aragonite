# Feature: where a caret arriving on a `:::` opener row rests in live mode

While the caret is on a `:::tip Title` row, live mode shows its `:::tip` dimmed, so every byte of the line is a place a caret can sit. A caret put down on the line from elsewhere still rests where it would with the name hidden: at the title's start (byte 7 of `:::tip Title`), or at the row's end when the row has no title. A letter typed there goes into the title and the callout stays. ArrowLeft remains the way into the name and the colons.

## Happy paths

- Home from inside the title, then `x`: the caret rests at the title's start and the row reads `:::tip xTitle`.
- Home from inside the name (reached by ArrowLeft): the caret moves to the title's start, as live-mode Home leaves revealed syntax for the line's first text elsewhere (a formula's shown source, a heading's text past its `#`).
- Home on an untitled `:::tip` row: the caret stays at the row's end.
- Mod+Home from inside the title: the title's start.
- ArrowUp from the body's start, then `x`: the title's start, `:::tip xTitle`.
- ArrowUp from inside the body (column 3, left of the title's text): the title's start.
- ArrowUp onto an untitled row: the row's end.
- ArrowDown from the line above: the title's start.
- ArrowRight from the end of the line above: the title's start.
- ArrowRight from the gap above a callout that starts the document: the title's start.
- Delete from that gap: the title's start, and nothing is deleted.
- A click at the row's left edge from the body, then `x`: the title's start, `:::tip xTitle`.
- A click at the row's left edge with the caret already on the row: the title's start.
- A click at the block's far left edge (the margin, not the text): the title's start.
- A press in the row's top padding: the title's start.
- A right-click at the row's left edge (the menu's caret, the menu then closed): the title's start.
- A click at an untitled row's left edge: the row's end.
- ArrowUp from a nested row whose column falls right of the outer title's start: the column is kept (`::::note Outer`, byte 10).

## Left as they were

- ArrowLeft from the title's start, seven presses: the caret walks through the name and the colons to byte 0.
- End, Shift+Home, then `Q`: the row reads `:::tip Q` and the callout stays.
- Source mode, Home from the title: byte 0, where source mode's row is text like a heading's `#`.
- Source mode, ArrowUp from the body: byte 0.
- A switch from source mode with the caret at byte 0: the caret rests at the title's start in live mode, as before.
- Delete at byte 0, then undo: the bytes come back and the caret rests at the title's start, as before.
- The host's `setSelection` at byte 4 of the row while the caret is on it: the caret is put exactly there.
- A `<details>` summary, Home from inside it: the summary's start, byte 0, which is its title's start.

## Regressions

- Home in a callout's title, ArrowUp from its body, or a click at its row's left edge put the caret before the `:::` in live mode, and the next letter turned the callout into a paragraph. Miss-analysis: every arrival spec landed on prose or a heading, whose markers live mode hides at the caret; the one row that shows its markers at the caret had no arrival row at all.
