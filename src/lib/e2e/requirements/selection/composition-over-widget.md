# Feature: IME composition over a widget selected whole

A composition that starts while a widget is selected whole (a picture, a live `<br>`, a plugin's chip) removes the widget first, the way one over a range across blocks removes the range, and the composed run takes its place. Every scenario runs in source and live mode.

Only Chromium's rows carry the browser's real event order (a CDP composition). WebKit and Firefox have no such driver, so there the harness fires the events by hand (`e2e/simulation/ime.ts`), and those rows say what the editor does with the events, not what the engine sends.

## Happy paths

- Compose `か`, then `かん`, then commit `漢` over each widget below. While composing, the source holds the removal and nothing else. The commit lands `漢` once where the widget was, with the caret right after it, and one Ctrl+Z puts the widget back.
  - a picture clicked, with text on both sides
  - a picture reached by ArrowRight, so its hidden caret sits at its start
  - a picture alone in its block: the paragraph stays and takes the text
  - a line break reached by ArrowRight
  - a plugin's chip in a paragraph, selected with Mod+K
  - a plugin's chip in a table cell: the text lands in that cell
  - a plugin's chip alone in a table cell: the cell stays and takes the text

## Edge cases

- A picture inside `**…**`: in source mode the text lands inside the pair (`lead **漢** tail`). In live mode the removal drops the pair it emptied, as a range's removal does, so the text is plain (`lead 漢 tail`); a typed key keeps the pair there.
- An abandoned composition (compose `か`, then commit nothing) over each of those widgets leaves the widget removed and types nothing; one Ctrl+Z puts it back.
- After the commit and one Ctrl+Z, the caret is where a typed key's undo leaves it over the same widget: the edge it was selected from. Checked for a click (its end) and for ArrowRight (its start).

## Pinned below the browser

- `test/selection/cross-block/keydown-entry-arms.test.ts`: at `compositionstart` a selected widget's bytes go before the handler returns and the widget is no longer selected; a selected widget whose bytes are already gone is ended and nothing is written.

## Miss-analysis

- Every composition row started at a caret or over a range across blocks, so none started over a selected widget, where the composition ran at the hidden caret beside it and left the widget selected.
