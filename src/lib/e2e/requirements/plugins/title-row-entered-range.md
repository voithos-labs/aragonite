# Feature: a range that runs onto a title row from outside

A container's title row (`:::tip Title`, a `<details>` summary) is text after a marker. A range that runs onto the row from outside and on into the body clears the part of the title it covers and keeps the marker, so the box stays and the title goes, as it would for any text the range covers. Driven on `/test/plugins` (seed `admonitions`, or `details`) in live and source mode, the range drawn by a mouse drag from `ab|ove` to `bo|dy`.

Miss-analysis: the rows that ran a range past a title row pinned the title kept, read off a ruling that kept the whole opening a range enters, so none compared it with the same range stopped inside the title, which clears it.

## Happy paths

- Backspace or Delete over the range: `ab`, then `:::tip ` (the marker, its space kept), then `dy`
- A letter, a paste of one line, or an IME composition over the range: the text lands after `ab`, the title cleared
- Enter over the range: the break goes after `ab`, the title cleared
- The same range made by Shift+ArrowDown three times from `ab|ove`, then Backspace: the title cleared, `body` whole

## Edge cases

- A generic `:::foo` box: as a callout
- A `::::note` over a `:::tip`, the range from above into the inner body: both titles cleared, both markers kept
- The inner box entered from the outer box's body: only the inner title cleared
- In a quote and in a list item: the title cleared behind the line's markers
- From the body of another box above: the second box's title cleared, the first box closed as it was
- A `<details>` summary: emptied to `<summary></summary>`

## User interactions

- A cut, then Ctrl+V where it left the caret: the document back, byte for byte
- A cut, then a paste on a new line under the box: a second box holding the title, the first box keeping only its marker, so the title is moved, never doubled
- A range from the body up into the middle of the title (a backward drag), cut, then pasted on a new line under the box: the pasted box holds only the part of the title the cut took
- Undo gives the title back; redo clears it again

## Controls

- An untitled row (`:::tip`): the name stays, nothing else on the row
- A range that ends inside the title: the rest of the title stays (`:::tip tle`)
