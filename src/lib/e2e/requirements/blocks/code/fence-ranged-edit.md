# Feature: Edits that reach a code block's hidden fence lines

Where the mode hides a code block's fence lines (live mode, and reading mode, which takes no
edits anyway), the block's editable content is its **body**, plus the opener's info string, which
the language picker writes. Every gesture that would rewrite the rest of a hidden fence line
(Backspace, Delete, type-over, cut, paste-over, select-all, a word delete, an IME composition
started over a selection) applies to the part of its range that overlaps the body instead. The
user can't see those bytes, so an edit must never change them.

Where the mode paints the fence lines, they're editable text instead, and the fence write rule
keeps the block legal: `fence-line-editing.md`.

The contract, in three parts:

- **Edits are clamped.** The edit applies to the part of its range that overlaps the body.
- **An edit that touches hidden structure alone does nothing.** It overlaps no part of the body,
  so it rewrites nothing and spends no undo entry.
- **Copy stays verbatim.** A read that changes nothing keeps the bytes the selection covers.

## Happy paths

- paste over a selection running from the body past its end replaces only the body part
  (paste's own delete-first step is clamped, not just the browser's delete)
- undo after a clamped delete restores the block byte-for-byte (one entry, placed at the
  start of the clamped span)

## Edge cases

- select-all then Backspace empties the body and keeps the code block a code block (it does
  not convert to a paragraph, as an unguarded browser delete of the whole display would)
- any replacement of a range keeps both fence lines: over a range that opens on the body's first
  highlighted word, a typed key (after a drag, Shift+Arrow or Ctrl+A), an emoji and an IME
  composition each replace only body text (miss-analysis: the ranged cases here deleted or
  pasted, so no test replaced a range, which the browser rewrote on its own and took the hidden
  opener with it; the first fix then covered one typed character, and a review found the rest)
- an IME composition over the whole body replaces it: the block deletes the selected body text
  as the composition starts, so the composed text lands inside the fence

## Pinned below the browser

No click or arrow puts a caret on a hidden fence line, so the gestures confined to one are
driven against the mounted block rather than end to end. Backspace inside the closer run and a
paste into either marker run commit nothing (`code-fence-ranged-edit.test.ts`).
`code-fence-edit-span.test.ts` runs every route that writes over a range (Backspace, Delete,
type-over, a typed bracket, an IME composition, cut, paste, and the removal before Enter) over
the same ranges in both modes: a range on fence structure alone commits nothing, and a delete
inside the body is applied by the block, since Chromium would take the hidden fence line beside
it.
(miss-analysis: when these fence lines became editable in source mode, the refusals were deleted
with their source-mode tests instead of moved to the mode that still hides the lines)

## Out of scope

Content whose _validity_ breaks the fence from inside a content region (a backtick typed into
a backtick fence's info string, a fence run typed or pasted into the body) is a different
class, character validity rather than structure, and is settled by `fence-content-validity.md`.
