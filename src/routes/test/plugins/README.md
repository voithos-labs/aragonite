# Dogfood plugins

Dev-harness plugins. The bundled tier now ships in the package — see
`src/lib/plugins/README.md`; what remains here is the dev fixtures plus the
reference plugins not yet packaged. Two roles, kept distinct:

## Reference plugins

Consumer-realistic extensions: the shapes plugin authors should copy. The bundled
reference plugins (admonitions, details, latex, mermaid, toc, highlight-occurrences)
now live in `src/lib/plugins/` and are demonstrated together on the `/` showcase
route; what still stages here is seed-gated only:

- `ghost-text/` — one component-widget island at the focused paragraph's end;
  the reference shape for in-flow widget decorations and their byte-safety.
  Seed-gated, not showcased.

## Fixture plugins

Exist to pin public surfaces under test; installed on `/test/plugins` only, never
showcased.

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
- `fold/` — `[>…<]` ranges fold to a clickable `…` replace island; pins
  `ReplaceDecoration.widget`, native interactivity inside an island, and the
  islands-in-cells gap (docs/issues.md). Seed-gated.
- `block-badge/` — class + badge widget on every heading host; pins
  `BlockDecoration.badge` incl. survival across windowing. Seed-gated.

`staggered/` is the route fixture for the staggered plugin-mount spec.
