# Feature: footnote references as inline widgets

The `[^label]` reference is an inline widget of its own kind, rendering the footnote number as a
superscript and showing its raw source for editing. Seed `footnotes-ref`: `Intro line here.` /
`Body has [^a] and [^b] here.` / two definitions. The references sit in block 1, so an earlier
reference typed into block 0 renumbers block 1 without editing it.

## Happy paths

- Seed render: block 1 shows two `.footnote-ref` superscripts reading "1" and "2", numbered by
  the order the references first appear, and the raw `[^a]`/`[^b]` bytes stay in the source.
- Type a reference live: typing `[^c]` into prose renders a fresh superscript once the closing
  `]` lands; until then, `[^c` stays literal text.

## The reactive renumber (load-bearing)

- Typing an earlier reference `[^z]` into block 0 renumbers block 1's widgets as you type ("1"
  becomes "2", "2" becomes "3") even though block 1 is never edited, because the widget derives
  its number from the live document rather than from a copy taken at mount.
- The renumbered widget keeps its identity, so block 1 is not remounted on every keystroke.

## Reveal to edit

- Moving the caret onto a reference with the keyboard shows the raw `[^a]` source in place. Only
  what is shown changes, so the source in the tree is untouched.
- Editing the label in the shown source and committing re-renders the widget with the new label
  and keeps the edit; the round-trip stays byte-stable.
- Showing the source, editing it and committing lands as one undo entry: a single undo restores
  the seed bytes.

## Edge cases

- Backspace next to a reference degrades the way the reveal policy says it should: it removes
  one delimiter byte, so the reference falls back to literal text, rather than deleting the
  whole widget in one keypress.

## Error cases

- What happens with the plugin not installed is a unit concern (`reference.test.ts`). With the
  plugin present, a throw while mounting would show on the editor's error channel, and the
  captured errors stay empty.
