# Feature: `/` showcase header chrome

The root route wraps `<Editor>` in a restrained header: the presentation-mode segmented
control, three toggles (theme, drag handles, debug panel), a keyboard hint and two links.
This spec owns the chrome, not the document. Two sibling specs already cover the rest of
the route and are not re-tested here: `plugins/showcase-route.md` covers the bundled-plugin
surface, `presentation/presentation-showcase.md` covers the mode toggle.

Like them, this route exposes no `window.__test` bridge — assertions read rendered DOM only,
and interactions are real clicks and key presses.

## Happy paths

- the seeded document is the pitch, not a syntax list: the opening paragraph states the
  round-trip promise, and the `[[toc]]` block renders an outline of the sections below it
- the theme toggle flips `data-editor-theme` on the editor root from `dark` to `light`
  and back, with the editor still mounted after each flip
- the drag-handles toggle removes the hover grips (`.block-drag-handle`) from the document
  and restores them, and the editor comes back with the same content
- `Ctrl+Shift+D` opens the debug panel over the showcase, and the header affordance closes
  it again — one state behind two controls
- the debug panel's CST section shows the live tree of the showcase document
- clicking a table-of-contents entry scrolls the editor to that heading
- selecting text floats the shared `SelectionToolbar` beside the selection — below it when
  the header's `topInset` leaves no room above, so the bar never lands on the header — its
  bold button wraps the selected run through `runCommand`, and collapsing the selection
  hides the bar (the component's own behavior matrix lives with
  `decorations/selection-toolbar.md`; this scenario also pins the inset flip, which only a
  chrome-bearing host can reach)
- the header's `changelog` link navigates to `/changelog`, landing on that route's own
  chrome rather than a 404 — the guard on `resolve()` under a configured base path

## Edge cases

- the drag-handles prop is set-once at mount, so its toggle remounts the editor: an edit
  made before the flip must survive it, since the route carries the live source across
- the editor gates drag handles off entirely in reading mode, so the toggle is disabled
  there rather than painting an active state it cannot produce
- the open panel is fixed to the right edge, so the header affordance has to stay clear of
  it: a click on the close control must not be intercepted by the panel it closes

## User interactions

- every toggle is driven by a real click, and the panel hotkey by a real key press
- text reaches the document by clicking a block and typing, never by a source setter

## Error cases

- zero `[invariant:…]` console fires across the chrome interactions (automatic via the
  shared e2e fixture)
