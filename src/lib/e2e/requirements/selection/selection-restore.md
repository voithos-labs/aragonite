# Feature: setSelection() restores a getSelection() snapshot

`editor.setSelection(selection)` is the inverse of `getSelection()`: a host persists a
snapshot (per tab, per session) and hands it back later. It reveals a windowed-out
target before placing anything — a synchronous focus cannot mount an off-window block
(VR-12) — and reports whether the restore landed instead of throwing.

It moves the viewport while it runs, and **hands it back when it resolves**: the reveal
claims no scroll position past the promise. A host restoring both a caret and a
remembered scroll writes them in that order, so anything the reveal kept would outrank
the scroll the host wrote last.

## Happy paths

- Collapsed caret in a prose leaf: the caret lands at the exact raw offset, `getSelection()` round-trips the snapshot, resolves `true`
- Caret into a block that scrolled out of the window: the block mounts, scrolls into view, the caret lands, resolves `true`
- Caret into a block still mounted but scrolled past the fold (the overscan band): the block is
  scrolled back into view — `true` means in view, not merely mounted
- Within-block range (same path, distinct offsets): the native range is re-established across the same offsets, resolves `true`
- Cross-block range: the selection re-enters cross-block state and the overlay paints, resolves `true`
- Intra-table cell rectangle (cell-valued offsets on unflagged endpoints): the same cell selection is restored, resolves `true`

## Edge cases

- Offset past the end of the block's content: the caret clamps to the block end, resolves `true`
- Reading mode (surface inert, `contenteditable` off): the selection is still placed as a
  native range inside the target block — reading keeps selection and navigation
- A block whose height settles asynchronously (a diagram, display math, an image decoding
  in) grows after the restore resolved: the scroll position the host wrote afterwards
  survives that measure pass

## Error cases

- Anchor or focus path no longer addresses a block (snapshot taken, then a shorter
  document loaded): resolves `false`, never throws, and performs no side effect —
  no scroll movement, no focus steal, no selection state change

## Miss analysis

The offset clamp is invisible from e2e: an over-long DOM offset already degrades to the
container end when the range is built, so the browser hides a missing model clamp. The
discriminating coverage is the pure resolver's unit test
(`src/lib/test/selection/selection-restore.test.ts`), which pins the clamp per coordinate
space — raw length for prose, last cell index for a table path.

The overscan-band scenario exists because every other in-view scenario scrolls its target out
of the window **entirely**, which forces a real mount-and-scroll. That hid the case a host
actually lands in after a normal user scroll: a target still mounted a few blocks past the
fold, for which the mount primitive short-circuits and never scrolls. "In view" needs a
scenario where the block is already mounted, or it only ever tests "mounted".

The hand-back scenario needs a block that grows **after** the restore resolved, and it has
to grow **below the fold**. Growth above the anchor legitimately moves `scrollTop` (the
top-of-viewport correction holding the visible position), so a scenario built there cannot
tell a held pin from an honest correction. Below the fold the honest delta is exactly zero,
which is what makes "the host's position is untouched" a discriminating assertion. The
baseline is read back rather than asserted as the number the host asked for: mounting the
blocks on the way down re-measures them, and that correction is legitimate too.
