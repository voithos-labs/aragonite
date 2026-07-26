# Feature: setSelection() restores a getSelection() snapshot

`editor.setSelection(selection)` is the inverse of `getSelection()`: a host persists a
snapshot (per tab, per session) and hands it back later. It reveals a windowed-out
target before placing anything — a synchronous focus cannot mount an off-window block
(VR-12) — and reports whether the restore landed instead of throwing.

## Happy paths

- Collapsed caret in a prose leaf: the caret lands at the exact raw offset, `getSelection()` round-trips the snapshot, resolves `true`
- Caret into a block that scrolled out of the window: the block mounts, scrolls into view, the caret lands, resolves `true`
- Cross-block range: the selection re-enters cross-block state and the overlay paints, resolves `true`
- Intra-table cell rectangle (cell-valued offsets on unflagged endpoints): the same cell selection is restored, resolves `true`

## Edge cases

- Offset past the end of the block's content: the caret clamps to the block end, resolves `true`
- Reading mode (surface inert, `contenteditable` off): the selection is still placed as a
  native range inside the target block — reading keeps selection and navigation

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
