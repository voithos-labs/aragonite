# Feature: Plugins Prop — staggered second-editor mount

A second editor can mount _after_ the first has already parsed, carrying a plugin
the first never had (`/test/plugins/staggered`: editor 1 = `[calloutPlugin()]`,
editor 2 = `[calloutPlugin(), detailsPlugin()]`, both on a seed holding a `:::callout`
and a `<details>` block; editor 2 mounts on a button click). This pins the
additive-`plugins`-prop-for-late-mounts claim the design rests on. Editor 2's
document is read through a distinct `window.__test2` handle (the install probe is
single-editor).

## Happy paths

- late-registered grammar is live for the late mount's own first parse: editor 2's `<details>` resolves to the `details` plugin kind (child 0 `details-summary`) — the grammar detailsPlugin registered at editor 2 mount serves editor 2's parse
- the shared plugin renders in both editors: `callout` resolves `:::callout` to a `callout` container (child 0 `callout-title`) in editor 1 _and_ editor 2, proving a process-global registration serves a later mount

## Edge cases

- an already-parsed document does not re-parse against a later grammar: editor 1 — parsed before detailsPlugin existed — keeps its `<details>` seed as the built-in `htmlBlock` (never `details`), and its `:::callout` stays `callout`; the only invariant console fire is the one expected `[invariant:late-opener-registration]` (details' opener registered after editor 1 consumed the grammar)

## User interactions

- a button click mounts the second editor after the first has parsed; the CST is read by path (`window.__test.getDocument()` / `window.__test2.getDocument()`), never through chained DOM locators
