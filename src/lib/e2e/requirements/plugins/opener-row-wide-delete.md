# Feature: a word or line delete on a `:::` opening row

A `:::` container's opening row holds its colons, its name and its title on one line. In live mode a word or line delete that starts in a title set apart from the name stops at the title's start, so clearing a title never unmakes the box; with nothing left in the title the key takes nothing. An untitled row's end and source mode delete as text, as a heading's `#` row does. A line delete that takes the row's colons unwraps the box, as removing the same selection does. Driven on `/test/plugins?seed=admonitions` with real keys; a line delete is sent as the `beforeinput` a Mac's Cmd+Backspace sends.

Miss-analysis (#851): the row's delete rows used Backspace by the character, so no row cleared a title with a word delete, and no row sent a line delete over the row's colons.

## Happy paths

- `:::tip T`, live, End, Backspace, then a word delete: nothing taken; the next letter writes `:::tip x`
- a loaded `:::tip ` (an empty title), live, a word delete at the row's end: nothing taken, no undo entry
- `:::tip Two words`, live, three word deletes from the end: `:::tip Two `, `:::tip `, then nothing
- `:::tip T`, live, ArrowUp (the caret at the title's start), a word delete: nothing taken, no undo entry
- `:::tip T`, live, a line delete from the title's end: `:::tip `, the box kept

## Edge cases

- an untitled `:::tip`, live, a word delete at the row's end: `:::`, the name deleted as text
- an untitled `:::tip`, live, Backspace three times then `note`: `:::note`, the box renamed
- source mode, `:::tip `, a word delete at the row's end: `:::`, as text
- source mode, `:::tip T`, a line delete from the row's end: `body`, the box unwrapped as the selected row's removal unwraps it

## User interactions

- a caret placed by the editor's selection call, then ArrowUp and End, then real keys

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
