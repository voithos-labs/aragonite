# Feature: inline widgets and decorations drawn by the app's own framework

The `?block-views` page (`block-views.md`) also draws two plugin views with the app's components,
through `reactView` or `vueView`: a chip for each `{{name}}` in the text (an inline widget), and a
badge on each memo line giving the memo's length (a block decoration, whose length rides in its
`data-memo-length` attribute). Both show the framework's name, which they read from the app's
context (React's `wrap` provider, Vue's app-level `provide` through the `app` option). The page
keeps a count of the views mounted right now on its root element, which each view's component
raises when it mounts and lowers when it unmounts. Every scenario fails on any console error, page
error or console warning.

## Happy paths

- The page loads with the chip and the memo's badge drawn by the app's components, each naming
  its framework from the app's context, and two views mounted.
- Typing before the chip keeps the same chip element and redraws it with its new offset (the
  view's `update`).
- Typing in the memo keeps the same badge element and redraws it with the new length.

## Edge cases

- A chip whose component throws (`{{boom}}`) shows its source text instead, and the throw goes
  to the editor's `error` event, not the console (React 18 logs it too, and can't be told not
  to); the other chip is untouched. Miss: React 19 and a Vue production build report a
  component's throw themselves instead of rethrowing it, so the editor never saw it, and no row
  had a view that throws.
- A chip typed into the box's child paragraph, a view root inside the box's own framework root,
  draws again with nothing on the console when the editor unmounts and mounts again.
- Deleting the chip with Backspace unmounts its view: the count drops by one and its element is
  gone.
- Loading another document unmounts the old views and draws the new one: only the new memo's
  badge is left.
- Unmounting the editor unmounts every view, inside the framework's own unmount, and mounting it
  again draws both. Miss: React refuses a root unmounted during its own commit, which only an
  unmount driven by the app shows.
- The Vue chip has two root nodes, where a slot prop it doesn't declare would warn about
  attributes it can't place, so it only gets the props it declares.
