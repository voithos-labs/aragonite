# Feature: `/` showcase route (bundled-plugin smoke)

The root route `/` is the developer-facing showcase: it mounts `<Editor>` with all
nine bundled plugins installed the way a consumer installs them (each imported from
its `$lib/plugins/<name>` subpath, latex/mermaid engines injected), seeded with a
document that exercises every built-in block kind alongside each plugin's syntax.
Unlike the machine-facing `/test/*` routes it exposes no `window.__test` bridge and
no debug panel — a real consumer's page has neither — so this smoke asserts through
the rendered DOM only.

The bar is deliberately just "the whole surface renders clean": the shared e2e
`test` fixture fails on any `[invariant:…]` console fire, so a passing run also
proves the showcase document loads without tripping an invariant under all nine
plugins. Editing behavior is owned by the machine-facing batteries and is not
re-tested here.

## Happy paths

- the editor mounts and renders a floor of blocks (`.block-host` count above a
  small threshold), proving the document parsed and the block list rendered
- an admonition renders its chrome (`.admonition` with a kind), and a `<details>`
  container renders its chrome (`.details-block`)
- a math widget island renders KaTeX output (a `.katex` element is present)
- the mermaid block renders its container (`.mermaid-block` visible) — presence of
  the async-rendered engine output is not asserted, only the settled container
- the table of contents lists the document's headings (`.toc-block-item` entries
  present), indented by level: the showcase nests to depth 4, so entries at more
  than one level class are present and the default outline shows real hierarchy
  rather than a flat list
- a footnote reference renders as a superscript number (`.footnote-ref` reading "1"
  by first-reference order) and its definition renders as an editable block
  (`.footnote-def` visible) — both plugin tiers on one document
- a GitHub alert (`> [!NOTE]` syntax) renders the admonition chrome with its bytes
  untouched — the native-alert kind, not a converted directive
- an emoji shortcode renders as a glyph widget, including inside a heading and a
  table cell (the shared widget dispatch, not per-surface plumbing)
- a ` ```math ` fence renders a second KaTeX block surface beside the `$$` form
- a sampling of built-in kinds is visible: a table and a fenced code block
- the bundled parrot renders on the demo: a `.parrot-block` with non-empty `pre.parrot` art
  and its caption, since the demo document carries a `%%parrot` line

## Edge cases

- mermaid renders asynchronously (the adapter dynamic-imports the engine); the spec
  settles on the always-present `.mermaid-block` wrapper with an auto-retrying
  visibility wait, never a fixed timeout or an engine-internal SVG locator

## User interactions

- navigation only: `page.goto('/')`. No `window.__test`, no debug panel, no
  editing — the machine-facing routes own interaction coverage
