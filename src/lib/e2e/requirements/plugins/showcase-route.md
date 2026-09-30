# Feature: `/` showcase route (bundled-plugin smoke)

Every expectation here is derived from `src/routes/showcase-content.md` at run time, never from
its prose. The owner rewrites that document by hand, and the suite that pinned its sentences
went red on the rewrite while proving nothing about whether the tour still works.

The root route `/` is the showcase for developers: it mounts `<Editor>` with all nine bundled
plugins installed the way a consumer installs them, each imported from its `$lib/plugins/<name>`
subpath, with the latex and mermaid renderers injected. Unlike the `/test/*` routes, which exist
for the tests, it exposes no `window.__test` bridge and no debug panel, since a real consumer's
page has neither, so this smoke test asserts through the rendered DOM only. It is also a
deployed page: a plugin that fails to register there degrades in front of visitors.

The bar is that the whole page renders cleanly. The shared e2e `test` fixture fails on any
`[invariant:…]` console message, so a passing run also proves the document loads without
tripping an invariant under all nine plugins. Editing behavior belongs to the batteries written
for the tests. Which kinds the document is meant to demonstrate at all is a unit concern, pinned
with its list of gaps in `src/lib/test/plugins/showcase-coverage.test.ts`.

## Happy paths

- the route hydrates and renders a floor of blocks, a `.block-host` count above a small
  threshold, which proves the document parsed and the block list rendered
- one pass down the document runs out of document rather than out of steps, ends with the last
  block mounted at the bottom of the scroll container, and mounts every top-level block in
  between, one after another from the first. That is the sanity check on windowing, and what
  makes the sweep's other counts trustworthy
- no block renders the raw editable fallback (`.raw-block`) or the render-error block
  (`[data-failed-block]`). The premise is that the tour demonstrates no kind that renders raw; a
  plugin that failed to install leaves the parser producing `htmlBlock` for the bytes it would
  have taken, and that is what shows up here
- every `$$…$$` display and ` ```math ` fence the document holds mounts a math widget with
  KaTeX painted inside it, so the injected renderer ran rather than the component merely
  mounting
- every ` ```mermaid ` fence the document holds mounts a mermaid widget. The document carries
  none today, so this passes on zero, and the gap is recorded in the coverage unit test
- the outline renders exactly when the document holds a `[[toc]]` line, with one entry per
  heading
- the parrot dances exactly when the document holds a `%%parrot` line: a `.parrot-block` with
  non-empty `pre.parrot-reel` art and its caption

## Edge cases

- windowing unmounts a block that scrolls away, so no single snapshot can count the tour: every
  count is a union over one pass down the document, stepping less than a viewport at a time so
  that no block can be skipped
- widgets paint from an effect, so a block that only just mounted may not have painted yet; the
  union forgives one miss, and letting things settle between steps makes it rare
- the scanner that reads the file is coarse by design, since a spec must not import the parser,
  so the assertions about what the document holds are separate named lines from the assertions
  about widgets: a scanner that disagrees with the parser fails its own line instead of
  weakening the others

## Error cases

- no uncaught page errors, with the collector attached before the navigation, because a plugin
  that throws while installing throws during hydration, which a listener attached afterwards
  never sees
- no `[invariant:…]` console messages (automatic through the shared e2e fixture)

## User interactions

- navigation and scrolling only. No `window.__test`, no debug panel and no editing: the routes
  written for the tests own the interaction coverage
