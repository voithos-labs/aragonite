# Feature: `/changelog` dogfood route

`/changelog` renders the repo's own changelog: long real documents, imported at build time from
`docs/changelog/<family>.md` and shown as they are, less the file's own pointer to the index,
behind a prelude the route prepends (a `[[toc]]` inside a collapsed `<details>`). All nine
bundled plugins are installed the way a consumer installs them, the outline is capped at the
version level, and the editor owns its scroll container, so virtual rendering is live. Like the
`/` showcase it exposes no `window.__test` bridge, so the assertions read the rendered DOM only,
and the shared e2e `test` fixture fails on any `[invariant:…]` console message, so a passing run
also proves the changelog loads without tripping an invariant under all nine plugins.

The page is reading only. Its header is the showcase's bar in miniature: the wordmark, a
release-family picker over the `source` prop (starting on the newest family), a link back to the
showcase and a theme switch, the theme shared with the showcase. The showcase's own mode switcher
is where the presentation modes are shown, so this route has none.

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
- the editor is in reading mode (`data-presentation="reading"` on the editor root), since a
  changelog is a document to read
- clicking another release family swaps the document to that family's file, and the outline
  serves the document on screen rather than the one it was first built for
- pressing the platform Find chord opens the find bar and focuses its input, with the document
  in reading mode and no block holding a caret
- at desktop width the release families sit in one segmented track and the header fits without
  overflowing: the families fold into a chip at a wider bar than the showcase's modes, so a new
  family can push the track past the bar
- the header's showcase link navigates to `/` and lands on the showcase page itself rather than
  a 404, which is what the `resolve()` call buys under a configured base path
- the route opens in the showcase's own default theme, light, on both the editor
  (`data-editor-theme`) and the page around it (the wrapper's background reads light)
- the header's theme switch flips the editor and the page around it to dark and back, showing
  itself pressed while dark
- a dark theme picked on the changelog carries back to the showcase through the header's link
- the theme a visitor picks on the showcase is the theme the changelog opens in: dark carries
  across the showcase's changelog link, and so does light, reached through dark and back. Dark
  also holds on a fresh load of `/changelog`, so the choice is stored, not just kept in memory
  across a client-side navigation. Miss-analysis: the theme rows asserted the showcase alone, and
  nothing ever loaded `/changelog` in light, so a route that passed no `theme` sat on the editor's
  dark default whatever the visitor had picked
- a returning visitor who picked dark sees `/` and `/changelog` dark before either hydrates: both
  are prerendered in the light default, so the stored choice is applied by an inline script at
  the end of the themed wrapper, read here with the app's scripts held back. Miss-analysis: every
  theme row waited for hydration, so none could see the light page painted before it

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

- real clicks on the disclosure, the outline entries, the header buttons (family and theme) and
  the header link, and a real Find chord on the keyboard; no programmatic prop pokes and no test
  bridge
