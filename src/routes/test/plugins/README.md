# Dogfood plugins

Dev-harness plugins — none ship in the package. Two roles, kept distinct:

## Reference plugins

Consumer-realistic extensions: what the `?plugins=1` showcase on `/test/editor`
installs, and the shapes plugin authors should copy.

- `admonitions/` — the five GitHub-alert directive kinds, editable titles, the
  GitHub-alert paste transform. Clean-room-built (0.9.12) and kept as-built: it is
  evidence of what the public docs alone can teach.
- `details/` — collapsible `<details>` container with summary chrome.
- `latex/` — inline `$…$` component widget + `$$…$$` block math (the editable-leaf
  render-primary validator).
- `mermaid/` — fence-claiming opaque container; the render-primary recipe for
  blocks that render as a picture.
- `highlight-occurrences/` — selection-driven decoration source: marks every
  whole-word occurrence of the word under the caret. The reference shape for
  `editor.decorations` + `selectionChange` wiring. Seed-gated on `/test/plugins`
  (its marks would annotate every sibling seed), not showcased.
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
