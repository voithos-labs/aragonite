# Feature: the `plugins` prop is the enablement set

Plugin definitions are process-global and first-wins, but activation is per instance:
an editor activates exactly the plugins its `plugins` prop lists. A plugin another
editor on the page installed, but this one did not list, attaches no `onEditor` hook
here and resolves no component for its kinds, which degrade to the raw-editable
fallback. An editor mounted with no prop keeps the documented default: everything
installed in the process is active there.

`/test/plugins/activation` mounts two editors over the same seed. The first lists
`parrotPlugin()` (a kind) and `blockBadgePlugin` (a decoration source); the second
lists only `docStatsPlugin`, which contributes neither. The first renders before the
second, so the parrot opener is live for both initial parses (the initial parse reads
the global grammar) and the two editors differ only in resolution.

Miss-analysis: every plugin spec mounted one editor with every plugin it cared about,
so no spec could see two editors disagree about a plugin. `registry-enablement.md`
came closest but sourced its predicate from the harness-only `__registryEnablement`
door, never from the prop.

## Happy paths

- both editors hold the parrot node: each editor's seed parses `%%parrot party responsibly` to a `[data-block-kind="parrot"]` block
- the listing editor renders the plugin component: its parrot block shows `.parrot-block` and no `.raw-block` fallback
- the listing editor attaches the decoration source: its heading carries the `.badge-h` badge widget
- built-ins are untouched on both sides: each editor renders its heading and its `Body` paragraph

## Edge cases

- the non-listing editor degrades the kind: its parrot block renders the `.raw-block` fallback with the `%%parrot` bytes visible, and no `.parrot-block`
- the non-listing editor attaches no decoration source: its heading carries no `.badge-h`, proving the `onEditor` hook never ran there

## User interactions

- activation scenarios: navigation only; both editors are read by DOM class, since the claim is what each instance resolved, not what either can edit
