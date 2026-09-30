# Feature: Plugins Prop, staggered second-editor mount

A second editor can mount _after_ the first has already parsed, carrying a plugin the first
never had (`/test/plugins/staggered`: editor 1 is `[calloutPlugin()]`, editor 2 is
`[calloutPlugin(), detailsPlugin()]`, both on a seed holding a `:::callout` and a `<details>`
block, with editor 2 mounted on a button click). This pins what the design rests on: a `plugins`
prop on a later mount adds to what is registered. Editor 2's document is read through its own
`window.__test2` handle, because the install check handles one editor only.

## Happy paths

- a grammar registered late is live for the late mount's own first parse: editor 2's `<details>` resolves to the `details` plugin kind, with child 0 a `details-summary`, so the grammar detailsPlugin registered when editor 2 mounted serves editor 2's parse
- the shared plugin renders in both editors: `callout` resolves `:::callout` to a `callout` container, with child 0 a `callout-title`, in editor 1 _and_ editor 2, which proves a registration global to the process serves a later mount

## Edge cases

- a document already parsed is not parsed again against a later grammar: editor 1, parsed before detailsPlugin existed, keeps its `<details>` seed as the built-in `htmlBlock` and never as `details`, and its `:::callout` stays `callout`; the only invariant message is the expected `[invariant:late-opener-registration]`, because details' opener registered after editor 1 had read the grammar

## User interactions

- a button click mounts the second editor after the first has parsed; the tree is read by path (`window.__test.getDocument()` and `window.__test2.getDocument()`), never through chained DOM locators
