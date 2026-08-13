# Feature: live-mode format toggles over a SELECTION

The § 5 contract row "Mod+B over a selection → wrap/unwrap selection, one undo
entry". A selection toggle is the half of the chord that writes bytes
immediately: live's pending-marks fork applies to a COLLAPSED caret only
(`presentation-live-pending-marks.md`), so over a range the same chord takes the
ordinary construct-aware wrap/strip seam in every mode. What live adds is that
the delimiters it writes are invisible — the rendered text is the only thing the
user sees change — and that the toggle interrupts the typing batch, so one
Ctrl+Z reverses exactly the toggle and leaves the typing before it alone.
Driven on `/test/editor` via `?presentationMode=live`; the source is the oracle,
since live paints no delimiter to assert against.

## Happy paths

- `Mod+B` over a selected word wraps it in `**` and the word renders bold
- `Mod+Shift+X` over the same selection wraps it in `~~`, and `Mod+E` in a
  backtick pair — live's two new chords over the same seam
- `Mod+B` over an already-bold word strips the pair rather than double-wrapping
- the same strip works for the other two: `Mod+Shift+X` over a struck word and `Mod+E` over a
  code span each take their own delimiters back off, whatever run length they were written with
- one `Mod+Z` after a toggle restores the pre-toggle bytes exactly

## Edge cases

- typing, then toggling, then one undo leaves the TYPED bytes in place: the
  toggle interrupts the keystroke batch instead of joining it, so the two are
  separate undo entries
- a toggle over a selection inside a heading stays inside the heading's content
  range — the `# ` prefix keeps its bytes whatever the selection reached
- the selection survives the toggle: a second press on the same selection
  reverses the first

## User interactions

- the selection is built with real `Shift+Arrow` presses from a real click, and
  the chord is a real key press; a programmatic range would skip the command
  dispatch the chord is claimed at
- source mode is asserted for the same gestures, where the delimiters are
  painted and the result is identical bytes — the toggle is not a live-only rule,
  only its invisibility is

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
