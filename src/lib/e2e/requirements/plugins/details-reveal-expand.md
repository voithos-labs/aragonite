# Feature: Plugin Container — Reveal Expands a Collapsed `<details>`

A reveal targeting a body child of a collapsed collapsible container expands the
collapsed ancestors first, as a real committed edit. The collapse clamp mounts
only the chrome row, so without the expansion the reveal finds its target outside
the live window and returns having done nothing: a toc entry pointing into a
collapsed section, or a search match found there, is a dead click.

The expansion is a document edit, not a view-only override: `open` is serialized
bytes, so the reveal commits it through the same metadata path the disclosure
toggle uses — undoable in one entry, visible to the `edit` event, and contained by
the commit error seam. The expand door itself is declared per kind
(`reservedChrome.expandPatch`, beside the `isCollapsed` probe the window clamp
reads); a collapsible kind that declares no door degrades exactly as before.

Unit-covered elsewhere: the expansion decision (collapsed-ancestor detection,
reading-mode gate, no-door degrade) in `test/editor-actions/reveal-expand.test.ts`
and `test/plugins/expand-door.test.ts`; reveal termination in
`test/reactivity/reveal-child-or-wait.test.ts`. What this gate proves is that the
expansion, the mount, and the scroll actually compose on the real navigation path
through a windowed document — the flush ordering no unit test can assume.

## Happy paths

- **toc click into a collapsed section:** a heading inside a closed `<details>` is
  listed by the outline; clicking its entry expands the container (the source bytes
  gain `open`, the disclosure reads expanded), mounts the heading, and scrolls it
  into view
- **search navigation into a collapsed body:** finding a needle that lives only in a
  closed body navigates to it — the same expansion, driven through `rects.scrollTo`
  from the search reveal rather than the toc queue
- **the target lands in view, not merely mounted:** the revealed nested heading's box
  intersects the editor viewport after the settle, in a document tall enough that the
  container starts windowed out

## Edge cases

- **one undo collapses it back:** a single Ctrl+Z after the navigation restores the
  document byte-for-byte (`<details>` closed again) and the body unmounts — the
  expansion is one undo entry, not a silent view flip and not two entries. The
  chord is typed straight after the click, with nothing put the caret back first:
  the navigation lands it in the revealed heading, so the gesture that makes the
  edit leaves focus where the undo for it can be typed.
- **an already-open container is not re-committed:** navigating to a heading inside an
  open `<details>` scrolls to it without touching the source bytes
- **reading mode does not expand:** the same toc click in reading mode leaves the
  document byte-identical and the body unmounted — reading mode commits nothing, so
  the reveal degrades to its pre-fix behavior

## User interactions

- the toc entry is activated with a real mouse click on the rendered `<button>`; the
  search match is reached by real Ctrl+F and typed keystrokes; undo is the real
  Ctrl/Cmd+Z chord — no bridge call drives any of the three
- in-view is asserted against the editor's own viewport rect by nested block path,
  independent of what `scrollTo` reports about itself

## Error cases

- the `[invariant:…]` console watcher stays silent and the editor's captured `error`
  events are empty across the expansion, the settle, and the undo
