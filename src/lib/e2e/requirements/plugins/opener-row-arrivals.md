# Feature: where a caret arriving on a `:::` opener row rests in live mode

While the caret is on a `:::tip Title` row, live mode shows its `:::tip` dimmed, so every byte of the line is a place a caret can sit. A caret put down on the line by a landing from another line, by Home, by a click, by ArrowLeft over a selection an arrival began, by PageUp or by the host's `navigateTo` still rests where it would with the name hidden: at the title's start (byte 7 of `:::tip Title`), or at the row's end when the row has no title. A letter typed there goes into the title and the callout stays. ArrowLeft remains the way into the name and the colons.

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
- Mod+A twice (the whole document), then ArrowLeft: the title's start. That range's collapse writes its caret before the row shows its name, so it landed there before the change too; the row pins the route.
- PageUp twice from the body, then `x`: the title's start, `:::tip xTitle`.
- PageUp held from far down a long page: the title's start.
- The host's `navigateTo` on the row with no offset, then `x`: the title's start, `:::tip xTitle`.
- The host's `navigateTo` on the callout with no offset: the title's start.

## Left as they were

- Source mode, Shift+Home, then ArrowLeft: byte 0.
- The host's `navigateTo` on the row at offset 0: byte 0, the offset it named.
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

## An arrow over a selection on the row

ArrowLeft over a selection on the row rests where the selection starts when a caret stood there, or Shift+Arrow steps took its start there from where a caret stood. When Shift+Home, Mod+A or a press put its start before the title, it rests where an arrival would: the title's start, or the row's end with no title. Then `x`:

- Shift+ArrowLeft twice from the title's start: byte 5, `:::tixp Title`.
- Shift+ArrowLeft five times from inside the title (byte 10): byte 5, `:::tixp Title`. The selection's start crossed the title's start a step at a time, as ArrowLeft five times takes the caret there.
- Shift+ArrowRight four times from byte 5: byte 5, `:::tixp Title`.
- Shift+ArrowLeft twice from byte 5: byte 3, `:::xtip Title`.
- Shift+Home from inside the title, from the title's start, and from byte 5: the title's start, `:::tip xTitle`.
- Mod+A from the title's start and from byte 5, and Mod+A then Shift+ArrowLeft: the title's start.
- A triple-click on the title from the body: the title's start.
- A Shift+click at the row's left edge from inside the title, from the title's start, and from byte 5: the title's start.
- An untitled `:::tip`, Shift+Home from the row's end or from byte 4, Mod+A, a triple-click on the name, or a Shift+click at the row's left edge: the row's end, and `x` writes `:::tip x`. ArrowLeft moves the caret right there, which keeps the callout.
- An untitled `:::tip`, Shift+ArrowLeft twice from the row's end, or Shift+ArrowRight twice from byte 4: byte 4, `:::txip`.
- ArrowRight over each of those selections: its end.
- A word step left (Ctrl+ArrowLeft, Option on macOS) over Mod+A or Shift+Home from the title's start: from the title's start into the name, byte 3, `:::xtip Title`; over Mod+A on an untitled row, `:::xtip`.

## A caret the browser leaves on the row

The browser puts these carets down itself; the caret writer moves one that lands before the title's start, unless the caret before it was already on the row at or before that start.

- Tab into the editor, then `x`: the title's start, `:::tip xTitle`. Firefox and WebKit put that caret at byte 0.
- Shift+Tab from the body, then `x`: the title's start, `:::tip xTitle`.
- The row element's own `focus()`, then `x`: the title's start, `:::tip xTitle`.
- ArrowUp inside a title that wraps, onto its first line: the title's start.
- ArrowLeft into the name, a letter typed in a field outside the editor, then a script's `focus()` on the row: the title's start, since focus left the row in between.
- The same after a letter typed in the name, which draws the row again (`:::txip Title`): its title's start, byte 8.
- ArrowLeft into the name, then `x`: `:::txip Title`, the caret after the `x`.
- ArrowLeft into `:::t|ip`, then Backspace twice: `:::ip Title`, then `::ip Title`. The first key renames the row to a name no plugin holds, which draws it again, and the second still deletes before the caret.
- The same with Delete twice: `:::tp Title`, then `:::t Title`.
- The same with Shift+ArrowLeft, Delete, then Backspace: `:::ip Title`, then `::ip Title`.
- ArrowLeft into the name, then a composition of `か`: `:::tかip Title`, the caret after it.

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
- A press from the body into a titled `:::foo Title` row: its drawn copy shows and its name does not until the release. A press from that row into the body: its name stays until the release, then the copy. Never both.
- An untitled `:::tip` or `:::foo` row reached by ArrowUp, then the button held down on the body: the row's marker paints nothing at once, as before, and nothing after the release.
- The button held down on a `:::tip T` row, then End and two Backspaces: the marker paints nothing until the title is gone, then paints, through the release.
- An untitled row reached by ArrowUp, then ` T`, then two Backspaces: the marker stays painted as the title gains its first letter and loses its last.
- A tap at the start of a title word: the caret rests there (byte 13), and `x` writes `:::tip Title xwords`.
- A double tap on a title word: that word. Not on desktop WebKit, which sends two taps as two single clicks.

## Where an arrival meets a write

An arrival puts the caret where the writes on the row expect it, so the two rules compose. Each row undoes in one step, the caret back where it stood.

- An untitled `:::tip` reached by ArrowUp, Home from inside the name, a click at the row's left edge, or Shift+Tab, then `x`: `:::tip x`, the caret after the `x`, one undo step back to `:::tip`. The same after ArrowUp with `7` and with `-`.
- A press held on an untitled row's end, `x` typed under it: `:::tip x`, the caret after the `x`; released, the name paints.
- A press held on `:::tip T`, End, Backspace, then `y`: `:::tip y`, the caret after the `y`. One undo takes the Backspace and the letter together, as one typing run.
- A press held on a title letter, Shift+Enter: nothing written, no undo step, the caret where pressed; `x` after the release goes there.
- ArrowUp onto `:::tip Title`, then Shift+Enter, in live and in source mode: nothing written, no undo step.
- ArrowUp onto `:::tip Title`, then a paste of `a`, a break, `b`: `:::tip a bTitle`. Onto an untitled `:::tip`: `:::tip a b`.
- A colon typed in a nested row's colons (`:::tip` inside `::::note`): both fences grow and the caret stays after the colon; ArrowUp to the outer row lands at its title's start, and `x` goes into the outer title. The second undo, which lands on the inner row from the outer one, rests at the inner title's start, as on `next`.

## Regressions

- A click on a title landed left of the letter clicked, a double-click selected a colon, and a drag ran into the colons, where the next letter turned the callout into a paragraph. The row showed its `:::tip` at mousedown and the title moved right under the pointer before the browser read the press. Miss-analysis: every click row pressed the row's left edge, where the landing is the same before and after the text moves; no row pressed a letter, double-clicked or dragged.
- On WebKit, a delete in a callout's name that renamed it put the caret at the title's start, and the next Backspace joined the name to the title (`:::ipTitle`). WebKit sends `focusin` after the landing's own write, and the row read as hidden until its host was marked at that event. Miss-analysis: the row was skipped on WebKit as the engine's own behaviour, measured against a base that already held the change, so no run compared it with the release.
- A press that left an untitled row painted its name twice until the release (`:::foo :::foo`, `Tiptip`): the stylesheet held the row's markers under its host's `data-focused`, while `browser/painted.ts` and the drawn copy read an untitled row off focus alone. Miss-analysis: the held-press rows all pressed onto a row; none pressed away from one, and the parity probe had no case for an untitled row under a marked host.
- Home in a callout's title, ArrowUp from its body, or a click at its row's left edge put the caret before the `:::` in live mode, and the next letter turned the callout into a paragraph. Miss-analysis: every arrival spec landed on prose or a heading, whose markers live mode hides at the caret; the one row that shows its markers at the caret had no arrival row at all.
- The padding press and the right-click ran on a titled row, where the browser lands at the title's start by itself, so neither row could fail with the rule removed. On an untitled row the rule decides both. Miss-analysis: each row was watched pass on the fix and never watched fail without it.
- ArrowLeft over a selection of the row, a second PageUp at the top, and the host's `navigateTo` with no offset put the caret before the `:::`, and the next letter turned the callout into a paragraph. Each is a caret the editor writes itself, at an offset a key or a caller computed, and none read the rule. Miss-analysis: the arrival rows covered the carets the block's landing places, and no list said which other caret writes were arrivals, so three were never given a row.
- Tab or Shift+Tab onto the row on Firefox and WebKit, the row's own `focus()` and ArrowUp inside a wrapped title left the caret at byte 0. The browser placed each one, and the caret writer passed over a caret it had not written only to fix a spot it never writes. Miss-analysis: the arrival rows ran on Chromium and through the editor's own landings; no row moved focus the way the browser does by itself.
- ArrowLeft over a selection judged by its bytes alone: Shift+Home, Mod+A, a triple-click or a Shift+click on an untitled row rested at byte 0, where a letter turned the callout into a paragraph; from a titled row's start, Shift+Home or a Shift+click did the same; and a selection Shift+ArrowRight made from inside the name, or Shift+ArrowLeft from inside the title, rested at the title's start instead of its own start. Miss-analysis: every collapse row started from byte 10, inside the title, where the bytes rule and the arrival rule agree; no row started from the title's start, the name or an untitled row.
