# Feature: inline-math clipboard during an active source reveal

A clipboard mutation (cut / paste) fired while an inline-math widget shows its
editable `$…$` source must fold that reveal into the CST first, then run against a
consistent tree — matching how keydown and IME already defer the per-keystroke
commit while revealed. Without the guard the clipboard handler splices into the
stale `node.raw` at a DOM-derived offset and the post-paste re-render wipes the
revealed text node while the reveal flag stays stuck, silently dropping all later
typing until blur.

Copy takes the opposite half of the same seam: it must never mutate, so it takes
no fold — but a selection over the revealed (uncommitted) edit must copy the live
DOM text, not the stale raw slice.

## Happy paths

- reveal + type + paste: enter the math source, type two chars, paste one — the
  serialized source carries the revealed edit and the pasted char, math delimiters
  intact.
- reveal + type + copy: enter the math source, type two chars, select the edit,
  copy — the clipboard carries the revealed live-DOM text, the reveal stays open,
  and the document is untouched (the edit never reaches the CST).

## Edge cases

- typing survives the paste: a char typed after the paste reaches the CST (the
  reveal flag was cleared by the fold, so input is no longer suppressed).

## User interactions

- ArrowLeft into `$x^2$` to reveal, keyboard type, synthetic paste event, keyboard
  type again, read serialized source.

## Error cases

- pre-fix regression: without the fold the revealed edit is lost and post-paste
  typing is dropped — the serialized source contains neither.
