# Feature: /test/editor plugin showcase toggle (default-off pin)

The main `/test/editor` harness installs every dogfood plugin behind an explicit
`?plugins=1` opt-in resolved in an SSR-consistent universal load. The toggle exists
so the owner can hand-test the plugins in the main harness; the load-bearing half is
that it defaults **off**. This route is also the fixture for the e2e, simulation, and
perf batteries, all of which assume a plugin-free grammar — a leaked `$` / `:::` /
` ```mermaid ` claim would reparse their fixtures — so the param-less path must stay
byte-identical to a plugin-free editor.

Read by path via `window.__test`, not visuals — matching the sibling plugin specs.

## Happy paths

- `?plugins=1` installs every dogfood before the seed parses: the showcase document
  resolves plugin kinds across the whole array — `note` (callout), `admonition`
  (a kind callout does not claim), `details`, `mathBlock`, `mermaid`, `memo` — and
  the whole document round-trips byte-for-byte under the live plugin grammar
- the toggle-on chrome shows a `plugins` badge so a manual tester knows the mode

## Edge cases

- **default-off pin (the spec that protects every other battery):** `/test/editor`
  with no param keeps a `:::note` seed as a `paragraph` — never `note` or
  `directiveContainer` — and the document carries no plugin kind at all, proving the
  plugin grammar is absent; the `plugins` badge is likewise absent

## User interactions

- toggle scenarios are navigation only (page load with / without the param); the CST
  is read by path via `window.__test`, never through chained DOM locators
