# Feature: header slot — host chrome inside the scroll container

A `header` snippet renders inside the editor's scroll container, above the first
block. It is the Obsidian inline-title shape: the host's document chrome (title,
properties panel, tags) scrolls away with the document instead of sitting in a
separate pane above it — and the editor keeps virtual rendering, which an outer
host scroller would forfeit.

`.editor-header` is a SIBLING of `.block-list`, never a wrapper: the windowing
scope resolves its list as a direct child of the root and measures that list's live
offset within the scroll content, so a preamble needs no slice-math change.

**The hazard is dynamic height.** The height model does not contain the slot, the
root's resize observer watches width only, and native `overflow-anchor` is off — so
a header that grows while the reader is scrolled deep would slide the document
under them silently. Slot height changes therefore route through their own scroll
compensation, with one exception: at the very top the header is on screen and
growth pushing content down IS the expected reading, so nothing compensates there.

Fixtures: `/test/editor?header=on` (a filler panel that toggles between 80px and
240px, toggled from a control OUTSIDE the scroll container so the gesture itself
cannot scroll), and the `entry-header` entry on `/test/flow` for host mode.

## Happy paths

- With no `header` prop no `.editor-header` element exists — the default path's DOM is unchanged.
- The header renders as a direct child of the editor root, above the first block, and the block list is still a direct child of the root beside it.
- The header scrolls away with content: scrolling the editor moves the header's viewport top by the scroll delta.
- Windowing still activates with a header mounted: a multi-thousand-block document renders spacers and keeps the mounted set bounded (the same O(viewport) bound the no-header gate asserts).
- `rects.scrollTo` to block 0 from deep in the document lands block 0 inside the scrollport with the header mounted.

## User interactions

- Toggling the header between 80px and 240px while scrolled deep leaves the first visible block at the same viewport position (±1px) and keeps it the same block — growing AND shrinking.
- The same toggle at the top of the document (scrollTop 0) shifts content down by the full height delta, and scrollTop stays 0: no compensation where the header is visible.
- A plain click on a link inside the header follows the link. Host chrome is not document content, so the editor's modifier-click link policy (plain click edits, Ctrl/Cmd-click activates) does not reach inside the slot.
- With the find bar open at scrollTop 0 the bar overlays the header's top strip. Accepted: the bar rides the editor's top edge in both scroll modes, and at the top of the document that edge is where the header is.

## Host mode (`scrollMode="host"`)

- The header renders above the first block in host mode too.
- A header height change leaves the ancestor scroller's `scrollTop` untouched. The editor never writes an ancestor's scroll position: the host page owns that scroll, the mounted set is complete (windowing is off), and a growing entry reflows the page like any other content change. The compensation observer is inert in this mode.
- The find bar sits at the editor root's top edge, over the header — persistently, since the root never scrolls in host mode. Accepted for the same reason as the self-mode overlay: one placement rule, not two mount paths gated on the mode.

## Error cases

- No uncaught page errors through load, scroll, height toggle, and reveal with a header mounted.
