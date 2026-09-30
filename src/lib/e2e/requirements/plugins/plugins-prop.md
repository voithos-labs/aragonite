# Feature: Plugins Prop, install before the first parse

The `/test/plugins` harness installs its four dogfood plugins through
`<Editor plugins={[...]}>` rather than registering them at module scope. The prop is processed
synchronously before the editor parses its seed, so the seed resolves to plugin kinds. These
checks pin the prop's own path: they assert the tree read by path through `window.__test`, not
visuals and not editing behavior, which belong to the per-plugin specs.

Installing the same plugin twice in one process, where the second install does nothing, is
pinned at the unit layer (`schema/plugin-install.test.ts`, plus the latex reset and reinstall
case in `plugins/latex-block.test.ts`). A browser reload is a fresh process, so the e2e covers
only the reload path here.

## Happy paths

- the prop installs the first listed plugin before the parse: the default callout seed's first block is a `callout` container whose child 0 is `callout-title`, never a `paragraph`, which is what a missing grammar gives, and never a `directiveContainer`, which is what the grammar gives when callout is not registered
- the prop installs every listed plugin, not only the first: the admonitions seed parses an `admonition` kind into the document, which proves a plugin at the end of the array installed before the seed parsed

## Edge cases

- a reload runs the prop again cleanly: navigating to the callout seed a second time still gives a `callout` container at mount, with no invariant message and a stable round-trip, so the prop's path is not first-load-only

A second editor mounted later is `plugins-prop-staggered.md`'s subject, one file per spec.

## User interactions

- the install-before-first-parse scenarios navigate and nothing more, by loading and reloading the page; the tree is read by path through `window.__test`, never through chained DOM locators
