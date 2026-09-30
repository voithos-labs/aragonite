# Feature: inline menu axe pass

An open inline menu puts two things on screen the rest of the axe battery never sees: the list
itself, a listbox of options over the editor's own colours, and the block the author is typing in,
which becomes a combobox naming that list. The seed is `/test/plugins?seed=inline-menu`, the same
one the behavioural suite drives.

## Happy paths

- With the tag list open under the caret, the editor has no axe violation outside the committed
  allowlist.

## Edge cases

- Exactly one element reads as a combobox while a list shows: the block the author typed in, never
  a second one left over from an earlier session.
