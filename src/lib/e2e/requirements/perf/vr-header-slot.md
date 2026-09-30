# Feature: header slot, host controls inside the scroll container

A `header` snippet renders inside the editor's scroll container, above the first
block. It is the Obsidian inline-title shape: the host's own document controls (title,
properties panel, tags) scroll away with the document instead of sitting in a
separate pane above it, and the editor keeps virtual rendering, which an outer
host scroller would forfeit.

`.editor-header` is a sibling of `.block-list`, never a wrapper: windowing
resolves its list as a direct child of the root and measures that list's live
offset within the scroll content, so a preamble needs no change to the slice math.

**The hazard is dynamic height.** The height table does not contain the slot, the
root's resize observer watches width only, and the browser's own `overflow-anchor`
is off, so a header that grows while the user is scrolled deep would slide the
document under them silently. Slot height changes therefore go through their own
scroll compensation, with one exception: at the very top the header is on screen and
growth pushing content down is what the user expects, so nothing compensates there.

Fixtures: `/test/editor?header=on` (a filler panel that toggles between 80px and
240px, toggled from a control outside the scroll container so the gesture itself
cannot scroll), and the `entry-header` entry on `/test/flow` for host mode.

## Happy paths

- With no `header` prop no `.editor-header` element exists, so the default path's DOM is unchanged.
- The header renders as a direct child of the editor root, above the first block, and the block list is still a direct child of the root beside it.
- The header scrolls away with content: scrolling the editor moves the header's viewport top by the scroll delta.
- Windowing still activates with a header mounted: a multi-thousand-block document renders spacers and keeps the mounted set bounded (the same O(viewport) bound the no-header gate asserts).
- `rects.scrollTo` to block 0 from deep in the document lands block 0 inside the scroll container with the header mounted.

## User interactions

- Toggling the header between 80px and 240px while scrolled deep leaves the first visible block at the same viewport position (±1px) and keeps it the same block, growing and shrinking alike. "Deep" matters on the shrink side: the correction is a `scrollTop` write, so it is bounded by the scroll available above (at `scrollTop 20` a −160px correction clamps at 0 and the content slides the remaining 140px, which no write could prevent and is not a defect). The contract holds for `scrollTop ≥ |delta|`.
- The same toggle at the top of the document (`scrollTop` 0) shifts content down by the full height delta, and `scrollTop` stays 0: no compensation where the header is visible.
- A plain click on a link inside the header follows the link. What the host puts in the header is not document content, so the editor's modifier-click link policy (plain click edits, Ctrl/Cmd-click activates) does not reach inside the slot.
- A caret in the header is not the document's caret: `rects.caretRect()` reports null while a host field in the slot holds the browser's selection, and reports normally for a block caret. A consumer polling it would otherwise float a caret-following panel over the host's own title.
- Switching to reading mode leaves a focused header field focused. Reading mode drops the editor's own caret; the host's own field is not the editor's to blur.
- A text field in the header keeps its own Find chord: focus inside the slot yields the editor's reserved chords (Mod+F, Mod+H, Escape) to the host, exactly as a field mounted outside the editor does. "Focus is inside the root" stopped meaning "focus is in this editor's content" the moment the slot existed, and a title field losing Find mid-typing is this feature's own use case breaking.
- With the find bar open at scrollTop 0 the bar overlays the header's top strip. Accepted: the bar rides the editor's top edge in both scroll modes, and at the top of the document that edge is where the header is.

## Host mode (`scrollMode="host"`)

- The header renders above the first block in host mode too.
- A header height change leaves the ancestor scroller's `scrollTop` untouched. The editor never writes an ancestor's scroll position: the host page owns that scroll, the mounted set is complete (windowing is off), and a growing entry reflows the page like any other content change. The compensation observer does nothing in this mode.
- The find bar sits at the editor root's top edge, over the header, and stays there, since the root never scrolls in host mode. Accepted for the same reason as the self-mode overlay: one placement rule, not two mount paths chosen by the mode.

## Accepted degradation

- A header taller than the scroll container degrades benignly rather than being supported: at scrollTop 0 the list's intersection with the viewport is zero, so the window correctly collapses to its floor (nothing of the list is on screen there), and it recovers a normal mounted set as soon as the user scrolls. Spacers stay non-negative and finite and no page error fires. Measured on a 1200px header over a 19,593-block fixture in a 633px scroll container: mounted 20 at the top, 35 once scrolled, 7 back at the top; spacer heights sane throughout.

## Error cases

- No uncaught page errors through load, scroll, height toggle, and reveal with a header mounted.
