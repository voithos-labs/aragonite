# Feature: Plugins Prop — install before the first parse

The `/test/plugins` harness installs its four dogfood plugins through `<Editor
plugins={[...]}>`, not module-scope registration. The prop is processed
synchronously before the editor parses its seed, so the seed resolves to plugin
kinds. This gate pins the prop pathway itself: it asserts the CST read by path via
`window.__test`, not visuals or editing behavior (those are the per-plugin specs).

Repeat-install within one process (same plugin installed twice → second is a
silent no-op) is pinned at the unit layer (`schema/plugin-install.test.ts`, plus
the latex reset→reinstall case in `plugins/latex-block.test.ts`); a browser reload
is a fresh process, so the e2e covers only the reload path here.

## Happy paths

- prop installs the first listed plugin before parse: the default callout seed's first block is a `callout` container whose child 0 is `callout-title` — never a `paragraph` (grammar off) or `directiveContainer` (grammar on, callout not registered)
- prop installs every listed plugin, not just the first: the admonitions seed parses an `admonition` kind into the document, proving a plugin at the end of the array installed before the seed parsed

## Edge cases

- reload re-runs the prop cleanly: navigating to the callout seed a second time still yields a `callout` container at mount, with no invariant console fire and stable round-trip — the prop pathway is not first-load-only

Staggered second-editor mounts are `plugins-prop-staggered.md`'s subject (1:1 with
its spec file).

## User interactions

- install-before-first-parse scenarios: navigation only (page load / reload); the CST is read by path via `window.__test`, never through chained DOM locators
