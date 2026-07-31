# Feature: TOC outline — hierarchy and click-to-navigate

The `[[toc]]` block renders the document's heading outline: entries indented by
heading level, labels projected to clean text, each entry a click-to-navigate
target that scrolls its heading into view AND lands the caret there. Navigation
mutates no CST bytes, so it works in every presentation mode; what it does write
is the selection, through the same restore road undo uses — otherwise focus stays
on the entry `<button>`, where the editor's own chords do not reach. Driven
through real mouse and the presentation-mode probe. (Label-projection field rules
and the level/path walk are unit-pinned in `heading-outline-*`; this file covers
the user-facing outline + navigation behavior.)

## Happy paths

- The outline indents entries by heading level: each entry carries a
  `toc-block-level-<n>` class matching its heading's level, so h1/h2/h3 render at
  increasing indent while the list keeps its `<ol>` semantics
- Clicking an entry scrolls its heading into view; the folded list stays shown
  (the entry click navigates, it does not reveal the raw source)
- Clicking an entry lands the caret in the target heading, so the next keystroke
  edits that heading instead of dying on the entry button. Reading mode places the
  same selection but leaves no editable target, which is what reading mode means.

## Edge cases

- **Windowed-out target (navigation rides virtual rendering):** in a document tall
  enough that a deep heading is windowed out (its block not mounted), the entry for
  that heading still lists (the outline reads the whole CST), and clicking it mounts
  the heading and brings it into view
- **Container-recursed heading:** a heading nested inside a blockquote is listed in
  the outline and navigates like a top-level one

## User interactions

- **Navigate in source mode:** clicking an entry scrolls to the heading and does
  NOT fold the block open to its raw `[[toc]]` source (the entry gesture suppresses
  the block's reveal-on-pointerdown)
- **Navigate in reading mode:** with the editor in reading mode, clicking an entry
  still scrolls to its heading — a navigation click is view-only, so reading-mode
  edit inertness is untouched
- **Keyboard-activate an entry:** entries are real `<button>`s — tab-focusable and
  activating on Enter/Space; focusing an entry and pressing Enter scrolls its heading
  into view, in both source and reading mode (navigation is view-only)
- **Non-entry click still reveals (source mode):** clicking the block's non-entry
  area reveals the raw source as before, in source mode only
- **Non-entry click is inert in reading mode:** clicking the block's non-entry area
  in reading mode neither reveals the source nor navigates — reading gates the reveal
  and a non-entry click reaches no navigation entry

## Error cases

- Rapid double-click on two different entries settles on the last-clicked target,
  with no error (navigation is serialized per block, so one block never has two
  carets landing and two scrolls competing; which PIN survives when claimants race
  across blocks is the reveal anchor's, in `perf/vr-reveal-anchor`)
