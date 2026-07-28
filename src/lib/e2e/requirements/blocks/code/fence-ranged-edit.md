# Feature: Ranged edits that span a fence line

Every gesture that rewrites a RANGE inside a fenced code block — Backspace, Delete,
type-over, cut, paste-over, select-all, a word delete, an IME composition started over a
selection — applies to the selection's intersection with the BODY. The two fence lines are
structure: an edit that consumed either of the line endings demarcating the body would fuse
a fence into the body and leave an unclosed fence that absorbs every following block at the
next parse.

The contract, in three parts:

- **Mutations clamp.** The edit applies to the intersection of its range with the body
  window. A range that stays inside one region — the opener's own text, the body, or the
  closer's own text — is untouched and keeps native behavior, so retyping an info string or
  deleting a closer backtick mid-edit still works.
- **A fence-only selection is inert.** Its intersection with the body is empty, so a delete
  rewrites nothing and spends no undo entry.
- **Copy stays verbatim.** A non-mutating read of a fence-crossing selection keeps the
  literal bytes, fences included. Cut is therefore asymmetric by design: a verbatim copy
  plus a clamped delete.

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
- a selection wholly inside the info string is edited verbatim: no clamp, no behavior change
- select-all then Backspace empties the body and keeps the code block a code block (it does
  not convert to a paragraph, as an unguarded native delete of the whole display would)
- Backspace with the caret at the start of the closer line is inert: the target range is the
  body's own line ending, whose intersection with the body is empty
- a word delete (Ctrl+Backspace) at the body start is inert for the same reason — the guard
  reads the pending edit's target range, not the caret

## Unverified

- an IME composition started over a fence-crossing selection re-seats the selection onto its
  body span before composing. Pinned at the component level (`code-fence-ranged-edit.test.ts`);
  browser-level IME behavior is not simulated by this harness.
