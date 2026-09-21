# Feature: TOC outline: hierarchy and click-to-navigate

The `[[toc]]` block renders the document's heading outline: entries indented by heading level,
labels reduced to clean text, and each entry a target that scrolls its heading into view and
puts the caret there. Navigating changes no bytes, so it works in every presentation mode; what
it does write is the selection, through the same code undo uses to restore one, because
otherwise focus stays on the entry `<button>`, where the editor's own chords do not reach.
Driven through the real mouse and the presentation-mode control. (How labels are reduced, and
the walk over levels and paths, have unit tests in `heading-outline-*`; this file covers the
outline and the navigation as the user meets them.)

## Happy paths

- The outline indents entries by heading level: each entry carries a `toc-block-level-<n>` class
  matching its heading's level, so h1, h2 and h3 render at increasing indent while the list
  keeps its `<ol>` semantics
- Clicking an entry scrolls its heading into view and the list stays shown, since an entry click
  navigates rather than showing the raw source
- Clicking an entry puts the caret in the target heading, so the next keystroke edits that
  heading instead of going nowhere on the entry button. Reading mode places the same selection
  but leaves nothing editable behind it, which is what reading mode means.

## Edge cases

- **A target that is not mounted (navigation works with windowing):** in a document tall enough
  that a deep heading is not mounted, the entry for that heading is still listed, because the
  outline reads the whole tree, and clicking it mounts the heading and brings it into view
- **A heading inside a container:** a heading nested inside a blockquote is listed in the
  outline and navigates like a top-level one

## User interactions

- **Navigate in source mode:** clicking an entry scrolls to the heading and does not open the
  block to its raw `[[toc]]` source, because the entry gesture suppresses the block's opening on
  pointerdown
- **Navigate in reading mode:** with the editor in reading mode, clicking an entry still scrolls
  to its heading, since a navigation click only changes the view and leaves reading mode as
  uneditable as it was
- **Activate an entry from the keyboard:** entries are real `<button>`s, reachable by Tab and
  activated by Enter or Space; focusing an entry and pressing Enter scrolls its heading into
  view, in source mode and reading mode alike, since navigating only changes the view
- **A click away from an entry still opens the source (source mode):** clicking the block away
  from its entries opens the raw source as before, in source mode only
- **A click away from an entry does nothing in reading mode:** clicking the block away from its
  entries in reading mode neither opens the source nor navigates, because reading mode blocks
  opening the source and a click away from an entry reaches no entry

## Error cases

- A rapid double-click on two different entries settles on the one clicked last, with no error,
  because navigation is handled one at a time per block, so a single block never has two carets
  landing and two scrolls competing. Which block's position is held when two blocks race is
  settled by the block held in place on screen, in `perf/vr-reveal-anchor`
