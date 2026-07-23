# Dogfood plugins

Dev-harness fixtures. The bundled tier — admonitions, details, emoji, footnotes, latex,
mermaid, toc, highlight-occurrences — ships in the package (`src/lib/plugins/README.md`) and
is demonstrated on the `/` showcase route. Everything here stays harness-side: installed
on `/test/plugins` (seed-gated where noted), never packaged, never showcased.

- `callout/` — the minimal titled directive container. The canonical reserved-chrome
  fixture: the four reserved-chrome e2e batteries, the chrome unit suites
  (range-delete, clipboard endpoints, merge collapse), and the simulation gestures
  all build on it — minimal on purpose, so those suites observe the chrome seams,
  not plugin features. Its co-registration ahead of admonitions on `/test/plugins`
  also keeps directive-name first-wins arbitration exercised. Redundant with
  admonitions as a _product_; load-bearing as a _fixture_ — that redundancy is
  resolved by classification, not deletion.
- `memo/` — a `%%` plain editable leaf; the only plain-mode `createEditableLeaf`
  consumer, driven by the editable-leaf e2e.
- `doc-stats/` — the options-default and multi-instance dogfood
  (`registerGlobalCommand` + per-instance context); promotable to the bundled tier
  later if evidence demands. `multi/` is its two-editor route fixture.
- `ghost-text/` — one component-widget island at the focused paragraph's end: the
  pattern demo for in-flow widget decorations and their byte-safety, without a
  completion backend. Seed-gated.
- `fold/` — `[>…<]` ranges fold to a clickable `…` replace island; pins
  `ReplaceDecoration.widget`, native interactivity inside an island, and the
  islands-in-cells gap (docs/issues.md). Seed-gated. Stays a fixture until the
  section-folding promotion call is made against evidence.
- `block-badge/` — class + badge widget on every heading host; pins
  `BlockDecoration.badge` incl. survival across windowing. Seed-gated.
- `sim-mark/` — the standing decoration source the simulation corruption oracle
  runs under `?seed=sim`.

`staggered/` is the route fixture for the staggered plugin-mount spec.
