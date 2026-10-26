# Feature: the shared top bar in the React and Vue showcases

The React and Vue example apps serve the showcase at `showcase.html`, with the same top bar the
Svelte showcase draws (`examples/showcase/top-bar.ts`). The host app owns every setting; the bar
only reports clicks and paints what the host hands back. The bar's own behavior (popovers,
closing, widths) is covered on the Svelte showcase, in `src/lib/e2e/requirements/showcase-chrome.md`.

## Happy paths

- A settings switch (dark mode, show source) flips the host's state, the page follows, and the
  switch reads pressed.
- The theme picked in the settings is the one the showcase opens in after a reload, since the
  demo site keeps it in one shared module (`examples/showcase/theme.ts`).
- A mode segment switches the editor's presentation mode and moves the pressed segment.
- The wordmark names the framework ("in React", "in Vue") and links to the repository.

## Edge cases

- Opening the settings popover and the report card, then closing each with Escape, leaves the
  same listeners on the document and window as before.

## Error cases

- Any console error, page error, aragonite dev warning or Vue warning fails the case.

## Miss-analysis

- The Vue showcase's first cut never repainted the bar: its watcher skipped reading the state
  while the bar was unmounted, so it tracked nothing. No suite opened either showcase, so only a
  screenshot caught it.
