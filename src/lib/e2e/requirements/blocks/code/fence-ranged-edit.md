# Feature: Edits that reach a code block's fence lines

A fenced code block's editable content is its **body** and the opener's **info string**.
Everything else in the two fence lines — the marker runs, the opener's indentation, and the
two line endings that demarcate the body — is structure, and every gesture that would rewrite
it (Backspace, Delete, type-over, cut, paste-over, select-all, a word delete, an IME
composition started over a selection, an auto-pair delete) applies to its range's intersection
with the body instead.

The line sits where the parser puts it. Each of these is one keystroke away, and each makes
the code node swallow every following block at the next parse:

| Edit                                    | Result                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| one closer backtick deleted             | the fence never closes                                 |
| one opener backtick deleted             | the block demotes; its closer opens an absorbing fence |
| one character typed into the closer run | the closer stops matching                              |
| a fourth leading space on the opener    | the block demotes to an indented code block            |

The contract, in four parts:

- **Mutations clamp.** The edit applies to the intersection of its range with the body window.
  A range confined to the body, or to the info string, keeps native behavior — retyping a
  language must keep working.
- **A structure-only edit is inert.** Its intersection with the body is empty, so it rewrites
  nothing and spends no undo entry. An insertion is refused rather than re-sited to the body
  edge: a character aimed at a fence must not land where the user never pointed. One rule for
  every gesture that writes — typing, paste and cut all decline at the same offsets.
- **An unclosed fence keeps its marker run editable.** With no closer to orphan, demoting the
  block to a paragraph is how a just-typed ` ``` ` is undone, and nothing gets absorbed.
- **Copy stays verbatim.** A non-mutating read keeps the literal bytes, fences included. Cut
  is therefore asymmetric by design: a verbatim copy plus a clamped delete, so cutting a
  fence-only selection copies it and deletes nothing.

**Un-fencing a closed block is not a gesture on this surface.** Editing the opener markers to
demote a closed fence to a paragraph is what the third table row does, so it is refused. The
exits that remain: select-all + Backspace empties the body and keeps the block; deleting the
block whole (a cross-block selection, or Ctrl+A twice) removes it.

## Happy paths

- Backspace over a selection running from the body into the closer deletes only the body
  part; the closing fence survives byte-for-byte
- Delete (forward) over the same selection behaves identically — the direction of the
  gesture does not change which bytes are structure
- typing a printable character over such a selection replaces only the body part
- paste over such a selection replaces only the body part (paste's own pre-delete is
  clamped, not just the native delete)
- Backspace over a selection running from the opener into the body keeps the opener line,
  info string included
- undo after a clamped delete restores the block byte-for-byte (one entry, anchored at the
  clamped span's start)

## Edge cases

- cut writes the selection to the clipboard verbatim — fence characters included — and
  deletes only the body part
- cut of a closer-only selection writes the fence to the clipboard and deletes nothing
- a selection wholly inside the info string is edited verbatim: no clamp, no behavior change
- select-all then Backspace empties the body and keeps the code block a code block (it does
  not convert to a paragraph, as an unguarded native delete of the whole display would)
- typing inside the closer run is inert; so is Backspace inside it (the auto-pair delete
  reads a caret between two backticks as a pair and must decline there)
- paste is inert wherever typing is: with the caret inside either marker run, and over a
  selection made only of fence characters
- deleting a selected opener marker run is inert on a closed fence
- an unclosed fence keeps its marker run editable: deleting it demotes the block to a
  paragraph, byte-for-byte
- Backspace with the caret at the start of the closer line is inert: the target range is the
  body's own line ending, whose intersection with the body is empty
- a word delete (Ctrl+Backspace) at the body start is inert for the same reason — the guard
  reads the pending edit's target range, not the caret

## Unverified

- an IME composition started over a fence-crossing selection re-seats the selection onto its
  body span before composing. Pinned at the component level (`code-fence-ranged-edit.test.ts`);
  browser-level IME behavior is not simulated by this harness.

## Out of scope

Content whose _validity_ breaks the fence from inside a content region — a backtick typed into
a backtick fence's info string, a fence run typed or pasted into the body — is a different
class (character validity, not structure) and is tracked in `docs/issues.md`.
