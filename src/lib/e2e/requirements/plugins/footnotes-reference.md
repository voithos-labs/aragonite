# Feature: footnote references as inline widgets

The `[^label]` reference is a first-class inline widget rendering the derived
footnote number as a superscript, revealed to its raw source for editing. Seed
`footnotes-ref`: `Intro line here.` / `Body has [^a] and [^b] here.` / two
definitions. References sit in block 1 so an earlier reference typed into block 0
renumbers block 1 without editing it.

## Happy paths

- Seed render: block 1 shows two `.footnote-ref` superscripts reading "1" and "2",
  numbered by first-reference order; the raw `[^a]`/`[^b]` bytes stay in the source.
- Type a reference live: typing `[^c]` into prose renders a fresh superscript once
  the closing `]` lands; before it, `[^c` stays literal text.

## The reactive renumber (load-bearing)

- Typing an earlier reference `[^z]` into block 0 renumbers block 1's widgets live
  ("1"→"2", "2"→"3") though block 1 is never edited — the widget derives its number
  from the live document, not a mount-time snapshot.
- The renumbered widget keeps its identity (no per-keystroke remount of block 1).

## Reveal to edit

- Keyboard caret entry against a reference reveals the raw `[^a]` source in place;
  the reveal is a view toggle, so the CST source is unchanged.
- Editing the label in the revealed source and committing re-renders the widget
  with the new label and persists the edit; round-trip stays byte-stable.
- The reveal→edit→commit cycle lands as one undo entry: a single undo restores the
  seed bytes.

## Edge cases

- Backspace adjacent to a reference degrades per the reveal policy: it removes one
  delimiter byte (the reference falls back to literal text), never the whole widget
  in one press.

## Error cases

- Uninstalled parity is a unit concern (reference.test.ts); with the plugin present
  a mount throw would surface on the editor error channel — captured errors stay empty.
