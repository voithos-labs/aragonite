# Feature: Plugin container: scrolling to a block expands a collapsed `<details>`

Scrolling to a body child of a collapsed container expands its collapsed ancestors first, as a
real committed edit. The collapse clamp mounts only the title row, so without that expansion the
scroll finds its target outside the mounted range and returns having done nothing: an outline
entry pointing into a collapsed section, or a search match found there, is a dead click.

The expansion is a document edit, not a view-only override. `open` is serialized bytes, so it is
committed through the same metadata path the disclosure toggle uses: one undo entry, visible to
the `edit` event, and handled by the commit path's own error handling if it fails. Each kind
declares how it expands (`reservedChrome.expandPatch`, beside the `isCollapsed` check the window
clamp reads), and a collapsible kind that declares nothing behaves exactly as it did before.

Covered by unit tests elsewhere: the decision to expand (finding collapsed ancestors, the check
for reading mode, degrading when a kind declares nothing) in
`test/editor-actions/reveal-expand.test.ts` and `test/plugins/expand-door.test.ts`, and stopping
rather than waiting forever in `test/reactivity/reveal-child-or-wait.test.ts`. What this file
proves is that the expansion, the mount and the scroll really do compose on the real navigation
path through a windowed document, in the flush order no unit test can assume.

## Happy paths

- **outline click into a collapsed section:** a heading inside a closed `<details>` is listed by
  the outline; clicking its entry expands the container (the source bytes gain `open` and the
  disclosure reads expanded), mounts the heading, and scrolls it into view
- **search navigation into a collapsed body:** finding a word that lives only in a closed body
  navigates to it, with the same expansion, driven through `rects.scrollTo` from search rather
  than through the outline's queue
- **the target ends up in view, not merely mounted:** the nested heading's box intersects the
  editor viewport once things settle, in a document tall enough that the container starts
  unmounted

## Edge cases

- **one undo collapses it back:** a single Ctrl+Z after the navigation restores the document
  byte for byte (`<details>` closed again) and the body unmounts, so the expansion is one undo
  entry rather than a silent view change or two entries. The chord is typed straight after the
  click, with nothing putting the caret back first: the navigation leaves the caret in the
  revealed heading, so the gesture that makes the edit leaves focus where its undo can be typed.
- **an already-open container is not committed again:** navigating to a heading inside an open
  `<details>` scrolls to it without touching the source bytes
- **reading mode does not expand:** the same outline click in reading mode leaves the document
  byte-identical and the body unmounted, since reading mode commits nothing and the scroll falls
  back to what it did before this was added

## User interactions

- the outline entry is activated with a real mouse click on the rendered `<button>`; the search
  match is reached with a real Ctrl+F and typed keystrokes; undo is the real Ctrl/Cmd+Z chord.
  No bridge call drives any of the three
- being in view is asserted against the editor's own viewport rect, by nested block path,
  independent of what `scrollTo` reports about itself

## Error cases

- the `[invariant:…]` console watcher stays silent and the editor's captured `error` events are
  empty across the expansion, the settling and the undo
