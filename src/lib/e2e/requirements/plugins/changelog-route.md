# Feature: `/changelog` dogfood route

`/changelog` renders the repo's own `docs/changelog.md` — a long real document, imported
at build time and shown verbatim behind a prelude the route prepends: a `[[toc]]` inside
a collapsed `<details>`. All eight bundled plugins are installed the consumer way, the
outline is capped at the version level, and the editor owns its scrollport so virtual
rendering is live. Like the `/` showcase it exposes no `window.__test` bridge, so
assertions are rendered-DOM only, and the shared e2e `test` fixture fails on any
`[invariant:…]` console fire, so a passing run also proves the changelog loads without
tripping an invariant under all eight plugins.

The header carries one control: a reading/source toggle over the live `presentationMode`
prop. That is the single-render-path claim made tangible — the same bytes, the same
render path, rendered or as styled source. Presentation-mode _behavior_ is owned by the
`e2e-presentation` project; this spec only pins that the route's toggle drives the prop.

## Happy paths

- the route mounts and renders the real changelog: the document's `# Changelog` heading
  is present and a floor of blocks is mounted
- the prepended outline is collapsed at load — the disclosure reads closed and no
  outline entry is mounted, so a reader lands on the newest entry rather than an index
- expanding the disclosure renders the outline, and clicking an entry navigates
- the editor starts in reading mode (`data-presentation="reading"` on the editor root),
  since a changelog is a document to read
- clicking "source" drops the attribute and paints markers again; clicking "reading"
  restores both
- pressing the platform Find chord opens the find bar and focuses its input, with the
  document in reading mode and no block holding a caret
- the header's showcase link navigates to `/`, landing on the showcase's own chrome
  rather than a 404 — the guard on `resolve()` under a configured base path

## Edge cases

- the reader's expand is transient: in reading mode the disclosure writes no bytes, so
  the `<details>` opener still reads `<details>` after the outline has mounted
- the document is long enough that its tail headings are windowed out at load, so the
  navigation scenario asserts the target is unmounted first — a click that only scrolled
  an already-mounted heading would prove nothing about the reveal path
- the navigation target is read from the outline's last entry at runtime rather than
  hardcoded, so a new version entry cannot stale the spec

## User interactions

- real clicks on the disclosure, outline entries, header buttons and the header link,
  and a real Find chord on the keyboard; no programmatic prop pokes and no test bridge
