# Feature: Edits that reach a code block's hidden fence lines

Where the mode hides a code block's fence lines (live mode, and reading mode, which takes no
edits anyway), the block's editable content is its **body** and nothing else. Every gesture that
would rewrite a hidden fence line (Backspace, Delete, type-over, cut, paste-over, select-all, a
word delete, an IME composition started over a selection) applies to the part of its range that
overlaps the body instead. The user can't see those bytes, so an edit must never change them.

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

## Unverified

- an IME composition started over a fence-crossing selection moves the selection onto its
  body span before composing. Pinned at the component level (`code-fence-ranged-edit.test.ts`);
  browser-level IME behavior is not simulated by this harness.

## Out of scope

Content whose _validity_ breaks the fence from inside a content region (a backtick typed into
a backtick fence's info string, a fence run typed or pasted into the body) is a different
class, character validity rather than structure, and is settled by `fence-content-validity.md`.
