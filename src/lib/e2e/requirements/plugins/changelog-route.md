# Feature: `/changelog` dogfood route

`/changelog` renders the repo's own changelog: long real documents, imported at build time from
`docs/changelog/<family>.md` and shown as they are, less the file's own pointer to the index,
behind a prelude the route prepends (a `[[toc]]` inside a collapsed `<details>`). All nine
bundled plugins are installed the way a consumer installs them, the outline is capped at the
version level, and the editor owns its scroll container, so virtual rendering is live. Like the
`/` showcase it exposes no `window.__test` bridge, so the assertions read the rendered DOM only,
and the shared e2e `test` fixture fails on any `[invariant:…]` console message, so a passing run
also proves the changelog loads without tripping an invariant under all nine plugins.

The header carries two controls: a release-family picker over the `source` prop, starting on the
newest family, and a reading/source toggle over the live `presentationMode` prop. The toggle
makes the one-render-path promise tangible: the same bytes, the same render path, rendered or
shown as styled source. How presentation mode _behaves_ belongs to the `e2e-presentation`
project; this spec only pins that the route's toggle drives the prop.

## Happy paths

- the route mounts and renders the real changelog: the family file's `# Changelog <family>`
  heading is present and a floor of blocks is mounted
- the prepended outline is collapsed at load: the disclosure reads closed and no outline entry
  is mounted, so the user lands on the newest entry rather than on an index
- expanding the disclosure renders the outline, and clicking an entry navigates. Asserted on the
  family with the longest outline, picked at runtime, so the precondition holds whatever family
  is newest: part of the document has to be scrolled out of the mounted range. Miss-analysis:
  the spec's runtime read defended against renamed entries, not against a first-release family
  whose single short entry leaves nothing unmounted, and 0.10.0's records commit staled it the
  day it landed
- the editor starts in reading mode (`data-presentation="reading"` on the editor root), since a
  changelog is a document to read
- clicking "source" drops the attribute and paints markers again; clicking "reading" restores
  both
- clicking another release family swaps the document to that family's file, and the outline
  serves the document on screen rather than the one it was first built for
- pressing the platform Find chord opens the find bar and focuses its input, with the document
  in reading mode and no block holding a caret
- the header's showcase link navigates to `/` and lands on the showcase page itself rather than
  a 404, which is what the `resolve()` call buys under a configured base path

## Edge cases

- the family file's "Newest first; the index is `../changelog.md`" line, right on GitHub and a
  404 beside this page, is dropped before the file mounts: no link ending in `changelog.md`
  renders, on the newest family or the oldest, and the oldest family's next sentence (its
  `git log` hint) still does. Miss-analysis: every scenario asserted the route's own prelude and
  the family file's title, never the file's own first line, so a link written for the repo tree
  rode onto the page with nothing asserting it
- expanding the outline writes nothing: in reading mode the disclosure changes no bytes, so the
  `<details>` opener still reads `<details>` after the outline has mounted
- the document is long enough that its tail headings are unmounted at load, so the navigation
  scenario asserts the target is unmounted first. A click that only scrolled an
  already-mounted heading would prove nothing about scrolling a block into view
- the navigation target is read from the outline's last entry at runtime rather than hardcoded,
  so a new version entry cannot stale the spec
- the picker's target and the family it starts on are both read at runtime, so adding a release
  family cannot stale the swap scenario

## User interactions

- real clicks on the disclosure, the outline entries, the header buttons (family and mode) and
  the header link, and a real Find chord on the keyboard; no programmatic prop pokes and no test
  bridge
