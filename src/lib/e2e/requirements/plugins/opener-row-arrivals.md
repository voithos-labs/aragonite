# Feature: where a caret arriving on a `:::` opener row rests in live mode

While the caret is on a `:::tip Title` row, live mode shows its `:::tip` dimmed, so every byte of the line is a place a caret can sit. A caret put down on the line by a landing from another line, by Home or by a click still rests where it would with the name hidden: at the title's start (byte 7 of `:::tip Title`), or at the row's end when the row has no title. A letter typed there goes into the title and the callout stays. ArrowLeft remains the way into the name and the colons.

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
- A press in an untitled row's top padding: the row's end.
- A right-click at an untitled row's left edge (the menu's caret, the menu then closed): the row's end.
- A click at an untitled row's left edge: the row's end.
- ArrowUp from a nested row whose column falls right of the outer title's start: the column is kept (`::::note Outer`, byte 10).

## Left as they were

- ArrowLeft from the title's start, seven presses: the caret walks through the name and the colons to byte 0.
- End, Shift+Home, then `Q`: the row reads `:::tip Q` and the callout stays.
- Source mode, Home from the title: byte 0, where source mode's row is text like a heading's `#`.
- Source mode, ArrowUp from the body: byte 0.
- Source mode, a click at the row's left edge: byte 0.
- Source mode, ArrowRight from the end of the line above: byte 0.
- A switch from source mode with the caret at byte 0: the caret rests at the title's start in live mode, as before.
- Delete at byte 0, then undo: the bytes come back and the caret rests at the title's start, as before.
- The host's `setSelection` at byte 4 of the row while the caret is on it: the caret is put exactly there.
- A `<details>` summary, Home from inside it: the summary's start, byte 0, which is its title's start.

## A press on a row not showing its name

A row with a title shows its `:::tip` when the press that focused it ends, so the title stays where the user saw it while the browser reads the press. `:::tip Title words`, the caret in the body:

- A click on a title letter: the caret rests on that letter (byte 14), and `x` writes `:::tip Title wxords`.
- The same click on a nested row: the letter clicked.
- A double-click on a title word: that word is selected (13..18), and `x` writes `:::tip Title x`.
- A double-click in preview-block: the same word.
- A drag across title letters: those letters (8..16), and `x` writes `:::tip Txds`.
- A drag leftward past the row's edge: it stops at the title's start (14..7).
- The button held down on a title letter: the marker paints nothing; released, it paints.
- ArrowUp onto the row: the marker paints at once.
- A press on an untitled row: the marker paints while the button is down. When End and ` T` give the row a title before the release, it paints nothing until the release, as a titled row does.
- The button held down on a `:::tip T` row, then End and two Backspaces: the marker paints nothing until the title is gone, then paints, through the release.
- An untitled row reached by ArrowUp, then ` T`, then two Backspaces: the marker stays painted as the title gains its first letter and loses its last.
- A tap at the start of a title word: the caret rests there (byte 13), and `x` writes `:::tip Title xwords`.
- A double tap on a title word: that word. Not on desktop WebKit, which sends two taps as two single clicks.

## Regressions

- A click on a title landed left of the letter clicked, a double-click selected a colon, and a drag ran into the colons, where the next letter turned the callout into a paragraph. The row showed its `:::tip` at mousedown and the title moved right under the pointer before the browser read the press. Miss-analysis: every click row pressed the row's left edge, where the landing is the same before and after the text moves; no row pressed a letter, double-clicked or dragged.
- Home in a callout's title, ArrowUp from its body, or a click at its row's left edge put the caret before the `:::` in live mode, and the next letter turned the callout into a paragraph. Miss-analysis: every arrival spec landed on prose or a heading, whose markers live mode hides at the caret; the one row that shows its markers at the caret had no arrival row at all.
- The padding press and the right-click ran on a titled row, where the browser lands at the title's start by itself, so neither row could fail with the rule removed. On an untitled row the rule decides both. Miss-analysis: each row was watched pass on the fix and never watched fail without it.

## Limits

The rule reaches a caret through the block's landing, Home and the click. These put a caret (or a range's edge) before the title's start in live mode and are not held:

- A range collapsed by ArrowLeft (after Shift+Home, Mod+A on the row or a triple-click).
- PageUp with the caret already on the row.
- Tab or Shift+Tab moving focus onto the row.
- ArrowUp inside a title that wraps, onto its first line.
- The host's `navigateTo` with no offset.
