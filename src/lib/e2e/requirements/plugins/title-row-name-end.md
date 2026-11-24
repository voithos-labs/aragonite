# Feature: text at the end of a bare `:::name`

A `:::` container's opener line with no title (`:::tip`) ends at its name. Text typed there that
would make the name longer starts the title instead (`:::tip x`), when the editor knows the name.
A name it doesn't know is typed letter by letter, so it keeps growing. Driven on
`/test/plugins?seed=admonitions` in live and source mode, the caret walked to the row's end with
ArrowLeft from the body's start; each row checks the bytes and the caret.

## Happy paths

- A letter, a capital, a digit or a dash typed there: a space, then the character, the caret after it
- An IME composition of a letter: nothing written while it is open, then the space and the letter at the commit
- A paste: the space, then the pasted text
- Six Backspaces from `:::tip Title` leave `:::tip`, and a letter then starts a new title
- One undo after the letter takes the letter and its space together

## Edge cases

- A character that cannot join a name (`!`): it goes in as typed, `:::tip!`
- An unknown name (`:::foo`): the letter grows the name, `:::foox`

## Miss-analysis

- No browser row typed at a bare name's end, so the letter that lengthened `:::tip` into an unknown
  box was pinned only as the old answer in a unit row.
