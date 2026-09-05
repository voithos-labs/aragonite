# Feature: the `plugins` prop is the enablement set

Plugin definitions are process-global and first-wins, but activation is per instance:
an editor activates exactly the plugins its `plugins` prop lists. A plugin another
editor on the page installed, but this one did not list, attaches no `onEditor` hook
here and resolves no component for its kinds, which degrade to the raw-editable
fallback. An editor mounted with no prop keeps the documented default: everything
installed in the process is active there.

`/test/plugins/activation` mounts two editors over the same seed. The first lists
`parrotPlugin()` (a kind) and `blockBadgePlugin` (a decoration source); the second
lists only `docStatsPlugin`, which contributes a global chord and neither of those. The
first renders before the second, so the parrot opener is live for both initial parses
(the initial parse reads the global grammar) and the two editors differ only in
resolution. Each pane is the other's unlisting editor: the chord belongs to the second,
the parrot syntax to the first.

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
- the chord is one instance's, not the process's: `reservedChords()` and `claimsChord()` report `Mod+Shift+S` in the editor that lists `doc-stats` and withhold it from the one that does not (regression #265: the chord was claimed process-wide, so it was swallowed and ran nothing in the editor that never listed the plugin)
- a paste parses through the instance grammar: `%%parrot dance` pasted into the editor that omits the parrot lands as prose in the paragraph it was pasted into, leaving that pane with the seed's one parrot block (regression #267: the clipboard parsed against every installed plugin, so the paste minted a kind that editor resolves no component for)

## User interactions

- activation scenarios: navigation only; both editors are read by DOM class, since the claim is what each instance resolved, not what either can edit
- the paste scenario is a real gesture: click into the paragraph, End, then Ctrl/Cmd+V over a seeded clipboard
- the chord scenario asks the instance doors rather than pressing the key: what a host needs to know is whether the editor claims the chord, and only `reservedChords`/`claimsChord` answer that
