# Feature: `/` showcase route (bundled-plugin smoke)

Every expectation here is derived from `src/routes/showcase-content.md` at run time, never
from its prose. The owner rewrites that document by hand, and the suite that pinned its
sentences went red on the rewrite while proving nothing about whether the tour still works.

The root route `/` is the developer-facing showcase: it mounts `<Editor>` with all nine
bundled plugins installed the way a consumer installs them (each imported from its
`$lib/plugins/<name>` subpath, latex/mermaid engines injected). Unlike the machine-facing
`/test/*` routes it exposes no `window.__test` bridge and no debug panel — a real consumer's
page has neither — so this smoke asserts through the rendered DOM only. It is also a
deployed page: a plugin that fails to register there degrades in front of visitors.

The bar is "the whole surface renders clean". The shared e2e `test` fixture fails on any
`[invariant:…]` console fire, so a passing run also proves the document loads without
tripping an invariant under all nine plugins. Editing behavior is owned by the machine-facing
batteries. Which kinds the document is expected to demonstrate at all is a unit concern,
pinned with its gap list in `src/lib/test/plugins/showcase-coverage.test.ts`.

## Happy paths

- the route hydrates and renders a floor of blocks (`.block-host` count above a small
  threshold), proving the document parsed and the block list rendered
- one pass down the document runs out of document rather than out of steps, ends with the
  last block mounted at the bottom of the scrollport, and mounts every top-level block in
  between contiguously from the first: the windowing sanity check, and what makes the
  sweep's other counts trustworthy
- no block renders the raw-editable fallback (`.raw-block`) or the render-error surface
  (`[data-failed-block]`). The premise is that the tour demonstrates no kind that renders
  raw; a plugin that failed to install leaves the parser producing `htmlBlock` for the bytes
  it would have claimed, and that is what shows up here
- every `$$…$$` display and ` ```math ` fence the document holds mounts a math island, and
  KaTeX painted inside each one — the injected engine ran, not merely the component mounted
- every ` ```mermaid ` fence the document holds mounts a mermaid island. The document
  carries none today, so this passes on zero; the gap is recorded in the coverage unit test
- the outline renders exactly when the document holds a `[[toc]]` line, with one entry per
  heading
- the parrot dances exactly when the document holds a `%%parrot` line: a `.parrot-block`
  with non-empty `pre.parrot-reel` art and its caption

## Edge cases

- windowing unmounts a block that scrolls away, so no single snapshot can count the tour:
  every count is a union over one pass down the document, stepping less than a viewport at a
  time so no block can be skipped
- islands paint from an effect, so a block that only just mounted may not have painted yet;
  the union forgives one miss and a settle between steps makes it rare
- the fs-side scanner is coarse by design (a spec must not import the parser), so the
  document-count assertions are separate named lines from the island assertions: a scanner
  that disagrees with the parser fails its own line instead of weakening the others

## Error cases

- zero uncaught page errors, with the collector armed before the navigation — a plugin that
  throws while installing throws during hydration, which a listener attached afterwards
  never sees
- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)

## User interactions

- navigation and scrolling only. No `window.__test`, no debug panel, no editing — the
  machine-facing routes own interaction coverage
