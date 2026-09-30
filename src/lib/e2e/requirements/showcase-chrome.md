# Feature: `/` showcase header controls

What the seeded document says is read out of `src/routes/showcase-content.md` at run time,
never quoted here: the owner rewrites it by hand, and the version quoting its prose went red
on the rewrite.

The root route wraps `<Editor>` in a restrained header: the presentation-mode segmented
control, three toggles (theme, drag handles, debug panel), a keyboard hint and two links.
This spec owns the page around the editor, not the document. Two sibling specs already cover
the rest of the route and are not re-tested here: `plugins/showcase-route.md` covers the
bundled plugins, `presentation/presentation-showcase.md` covers the mode toggle.

Like them, this route exposes no `window.__test` bridge: assertions read rendered DOM only,
and interactions are real clicks and key presses.

## Happy paths

- the editor opens on the seeded document: its first heading, read off the file's bytes, is
  the first heading the editor shows, and its `[[toc]]` line renders an outline
- the showcase opens in live mode and the light theme (the editor's own defaults stay
  source and dark; these are the demo's)
- the theme toggle switches `data-editor-theme` on the editor root from `light` to `dark`
  and back, with the editor still mounted after each switch
- the drag-handles toggle removes the hover handles (`.block-drag-handle`) from the document
  and restores them, and the editor comes back with the same content
- `Ctrl+Shift+D` opens the debug panel over the showcase, and the header's own button closes
  it again: one state behind two controls
- the debug panel's CST section shows the live tree of the showcase document
- clicking the outline's last entry scrolls the editor down to that heading, whichever
  sections the document happens to hold
- both toolbars are what live mode adds for WYSIWYG editing: switching to a markdown-first
  mode unmounts them, and switching back to live brings them in
- in live mode, selecting text floats the editor's selection toolbar (the `selectionToolbar`
  prop, which the showcase ties to live mode and its header toggle) beside the selection,
  below it when the header leaves no room above, since the editor root's top is the floor for
  that move, so the bar never lands on the header. Its bold button wraps the selected run through `runCommand`, and collapsing the
  selection hides the bar (the component's own behavior matrix lives with
  `decorations/selection-toolbar.md`; this scenario also pins the move inwards, which only a
  host with a header of its own can reach)
- in live mode, the shared `InsertToolbar` strip under the header greys until the document
  holds a caret, then its table button creates a real table through `insertMarkdown` (the
  component's own behavior matrix lives with `insert-toolbar.md`; this scenario pins the
  showcase mount)
- the header's `changelog` link navigates to `/changelog`, landing on that route's own
  header rather than a 404: the check on `resolve()` under a configured base path

## Edge cases

- the drag-handles prop is set once at mount, so its toggle remounts the editor: an edit
  made before the switch must survive it, since the route passes the live source across
- the editor turns drag handles off entirely in reading mode, so the toggle is disabled
  there rather than painting an active state it cannot produce
- the open panel is fixed to the right edge, so the header's button has to stay clear of
  it: a click on the close control must not be intercepted by the panel it closes

## User interactions

- every toggle is driven by a real click, and the panel hotkey by a real key press
- text reaches the document by clicking a block and typing, never by a source setter

## Error cases

- zero `[invariant:…]` console fires across these interactions (automatic via the
  shared e2e fixture)
