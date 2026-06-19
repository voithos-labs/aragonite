# Editor Invariants — Catalog & Enforcement

Living reference for the editor's load-bearing invariants and how each is enforced.

## Design

The editor's load-bearing contracts — round-trip fidelity, the `textContent === ambientPrefix + raw` spine, registration completeness, op-vocabulary parity, the inline-offset partition — were enforced by convention and example tests. Break one and you get silent corruption surfacing layers downstream, not a loud failure at the seam. This catalog converts that surface into loud, located failure, hardened before the 0.8.3 schema-seam freeze and the 1.2 plugin API bind external code to the contracts.

The unifying principle is **one catalog, one shared predicate per invariant, read by two consumers**: a runtime DEV assertion at the seam where the invariant can break, and a property/source-scan test — never logic duplicated between guard and test. Predicates are pure functions in `src/lib/editor/invariants/`, returning a violation or null; tests import them directly. The `assertInvariant` channel that runs them at runtime is dev-only and non-crashing (a false positive must never crash a real editor) and tree-shakes to a no-op in production — zero assertion cost. Per-commit checks are scoped to the touched subtree, never the whole document, so the guards stay safe to run during the large-doc workflow the project targets.

**Enforcement codes:** A = runtime DEV assertion · P = property test (fast-check) · N = negative fixture · T = compile-time type guard · L = lint/source-scan · D = doc.

Predicates live in `src/lib/editor/invariants/`; property tests + arbitraries in `src/lib/editor/test/invariants/` (`npm run test:editor:invariants`). The Group 2 predicates are **test-only** and must never be exported through `src/lib/editor/index.ts` (it would add a `→ selection` edge to the runtime DAG). All phases have landed; the tables below map each invariant to its predicate file, enforcing seam, and test file (file-level references — not line numbers, which drift).

## Group 1 — Runtime-checkable (A·P·N)

Seams: commit primitive = `invariants/install.ts` `assertCommittedNodes`, invoked from `editor-actions/undo-controller.ts` after each commit's raw rebuild. Bootstrap = `invariants/install.ts` `runStartupInvariantChecks`, invoked once from `Editor.svelte` after built-in registration.

| ID    | Invariant                                                                                                                                                                                                          | Codes   | Predicate · Seam · Test                                                                                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1.1  | Container raw not stale: `strip(raw) === serialize(children)` (grid containers exempt)                                                                                                                             | A·P·N·D | `node-shape.ts` `checkStaleRaw` · commit primitive · `stale-raw.test.ts`                                                                                                                                                                                              |
| G1.2  | Registry completeness: every `BlockKind` → descriptor + component                                                                                                                                                  | A·P     | `registry.ts` `checkRegistryCompleteness` · bootstrap (+ BlockHost visible-raw fallback for `listItem`) · `registry.test.ts`                                                                                                                                          |
| G1.3  | `isContainer` iff `rebuildRaw` (declared at registration)                                                                                                                                                          | A·P·N   | `registry.ts` `checkIsContainerIffRebuildRaw` · bootstrap · `registry.test.ts`                                                                                                                                                                                        |
| G1.4  | No container `setContext`s `HISTORY_KEY`                                                                                                                                                                           | A·L·N   | `context-keys.ts` · `editor-actions/nested-actions.ts` `setNestedActionsContexts` · `context-keys.test.ts` · `lint/no-container-history-key.test.ts`                                                                                                                  |
| G1.5  | Category↔field legality (leaf/prose/container fields; valid `mergeRole`)                                                                                                                                           | A·P·N   | `node-shape.ts` `checkCategoryFields` · commit primitive · `category-fields.test.ts`                                                                                                                                                                                  |
| G1.6  | `cloneMetadata` clone-safety                                                                                                                                                                                       | A·P     | `node-shape.ts` `checkCloneSafeMetadata` · `tree-operations/clone.ts` `cloneNode` · `clone-safe-metadata.test.ts`                                                                                                                                                     |
| G1.7  | Metadata-driven-raw writes go through `updateBlockMetadata`                                                                                                                                                        | A·N     | (no dedicated predicate) · `editor-actions/block-edit-core.ts` `updateBlockMetadata` rebuilds raw after the merge (both factories delegate to the shared core) · `editor-actions/update-block-metadata.test.ts` (G1.1 stale-raw is the runtime backstop for bypasses) |
| G1.8  | `getContentRange` well-formed per prose kind                                                                                                                                                                       | A·P·N   | `descriptor.ts` `checkContentRange` · commit primitive · `descriptor.test.ts`                                                                                                                                                                                         |
| G1.9  | Snapshot aliasing (bytes-scoped): no mutation writes serialized bytes through a node an undo/redo entry shares; exempt: `inlineContent` cache writes (derived, non-serialized) and live-tree moves of shared nodes | A·P·N   | `snapshot-integrity.ts` `checkSnapshotIntegrity` · commit primitive (top undo entry) + undo/redo restore (`editor-actions/history.ts`) · `snapshot-integrity.test.ts`, `test/undo/undo-restoration.property.test.ts`                                                  |
| G1.10 | Opener-registry coherence: every opener's kind has a descriptor; priorities unique                                                                                                                                 | A·N     | `registry.ts` `checkOpenerRegistry` · bootstrap · `opener-registry.test.ts`                                                                                                                                                                                           |
| G1.11 | Keymap coherence: every keymap command is a known id; chords unique per kind                                                                                                                                       | A·N     | `registry.ts` `checkKeymapCoherence` · bootstrap · `keymap-coherence.test.ts`                                                                                                                                                                                         |

**G1.1 is byte-level, not structural.** It compares `strip(raw)` (the re-parsed correspondent's stripped-inner bytes) against `serialize(children)` — exactly the documented invariant. It deliberately does **not** structurally compare the re-parsed tree to `node.children`: an empty editable container holds a single empty-paragraph placeholder so it has a focusable leaf, which the parser emits as `innerSuffix`/trivia for byte-identical output (`- \n`, a trailing blank `>` line). Both forms satisfy the invariant. Don't re-tighten to a structural tree compare — it false-fires on every empty list item and trailing blank quoted line, and that false positive went unseen until the simulation oracle was wired to the invariant channel.

**G1.2 exempts `listItem` from the component check.** It has no component-registry entry by design — items render inside their parent `ListBlock`, never via a `BlockHost` kind lookup — so the predicate skips the component check for it (`NO_STANDALONE_COMPONENT`), keeping the bootstrap channel free of a benign per-mount warning; the `BlockHost` visible-raw fallback still covers any stray lookup. `tableRow`/`tableCell` are registered as raw-block fallbacks, so `listItem` is the sole exemption.

G1.9's copy-path-on-write writes follow the `$state` canonical-reference discipline — after splicing a copy into the live tree, re-read it through the tree before further use; `tree-operations/unshare.ts`'s header owns the full statement.

**Commit-rollback contract (0.7.10.1).** Where G1.9 guards against a mutation corrupting a _shared_ snapshot, this guards against a _dangling_ one: a commit mutation that throws must leave the undo/redo stacks byte-identical to their pre-commit state and must not publish a partial tree. `__commit` captures both stacks before the snapshot push and, on throw, restores them via `UndoManager.restoreStacks` (a wholesale restore that also recovers an entry the push evicted at `MAX_UNDO`), emits `error{origin:'commit'}` on the event seam, then re-throws in DEV / swallows in production — the tree stays intact because mutations run on copies published only on success. Covered by `test/editor-actions/commit-rollback.test.ts`.

## Group 2 — Property/regression-tested (P·N)

Test files under `test/invariants/` (arbitraries in `test/invariants/arbitraries/`).

| ID    | Invariant                                                       | Codes | Test                                                                       |
| ----- | --------------------------------------------------------------- | ----- | -------------------------------------------------------------------------- |
| G2.1  | Round-trip + parser totality over arbitrary strings             | P·N   | `round-trip.property.test.ts`                                              |
| G2.2  | EOF edge states round-trip (unclosed fence, unterminated HTML)  | P·N   | `round-trip.property.test.ts` (G2.2 block)                                 |
| G2.3  | Inline conformance corpus                                       | P     | `inline-conformance.property.test.ts`                                      |
| G2.4  | `textContent === ambientPrefix + raw` spine (jsdom)             | P     | `textcontent-spine.property.test.ts`                                       |
| G2.5  | Inline-tree offset partition                                    | P·N   | `inline-offsets.property.test.ts`                                          |
| G2.6  | Serialization purity (ignores inlineContent/metadata)           | P     | `serialization-purity.property.test.ts`                                    |
| G2.7  | Selection partition + `walkBetween` order                       | P     | `selection-partition.property.test.ts`                                     |
| G2.8  | Split/merge round-trip + id↔ref↔children alignment (all scopes) | P·N   | `structural-id-ref-alignment.test.ts`                                      |
| G2.9  | Paste op-kind dual-emit                                         | P     | `paste-op-kind.test.ts`                                                    |
| G2.10 | Sticky-column matrix + capture-without-reset guard (jsdom)      | P·A   | `sticky-column-matrix.test.ts`, `lint/sticky-column-capture-reset.test.ts` |

## Group 3 — Compile-time type guards (T)

All landed. Guards are enforced by the type checker (`npm run check`); no runtime seam.

| ID   | Guard                                   | Retires                        | Status |
| ---- | --------------------------------------- | ------------------------------ | ------ |
| G3.1 | `BlockMetadataByKind` + `metadataOf<K>` | `as` metadata casts            | landed |
| G3.2 | `defineBlockComponent`                  | `as unknown as` casts          | landed |
| G3.3 | Discriminated `SelectionPoint`          | char-vs-cell `offset` overload | landed |
| G3.4 | Branded `CURSOR_END` / `SELECTION_END`  | `999999` magic number          | landed |
| G3.5 | `containerContract: 'strip' \| 'grid'`  | implicit table exemption       | landed |

## Group 4 — Lint/structural + harness

All landed. Source-scan tests live under `test/invariants/lint/`.

| ID   | Invariant                                                                                                                                                        | Codes   | Test                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| G4.1 | No by-value `createBlockListState` (getters only)                                                                                                                | L       | `lint/createblockliststate-getters.test.ts`                           |
| G4.2 | No `.inlineContent` read in the render path                                                                                                                      | L       | `lint/render-inlinecontent.test.ts`                                   |
| G4.3 | Container-author conformance kit + declaration sanity (unwrapRole strategies resolve, containerPaste shape, rebuildRaw runs)                                     | harness | `container-conformance.test.ts` (kit: `container-conformance-kit.ts`) |
| G4.4 | No timing hacks for sequencing (timing primitives allowlisted)                                                                                                   | L       | `lint/timing-hacks.test.ts`                                           |
| G4.5 | No synthetic `KeyboardEvent` in editor runtime source (cross-block redispatch hack retired)                                                                      | L       | `lint/no-synthetic-keyboard-event.test.ts`                            |
| G4.6 | CSS ownership: `app.css` holds no editor rules/tokens; every editor-owned token read is declared in `editor-theme.css`; every host-token read carries a fallback | L       | `lint/css-ownership.test.ts`                                          |

G4.4 allowlist (the only sanctioned timing primitives — anything else trips the scan): rAF throttles in `selection/autoscroll.ts` (frame-paced autoscroll), `selection/drag-pointer.ts` and `components/blocks/table/cell-pointer.ts` (pointermove coalescing during drag); plus the `setTimeout` wall-clock undo debounce in `editor-actions/text-batch.ts` (a tick-grained microtask can't express a "user stopped typing" pause).

## Accessibility (WCAG 2.1 AA — axe ratchet)

Target: WCAG 2.1 AA, enforced by an `@axe-core/playwright` baseline-ratchet gate (`test:e2e:a11y`, part of `npm test`). axe runs over `.editor` across representative states (default content, active cross-block selection, failed-block fallback, blocked-scheme link) and fails on any violation whose rule id is not in the committed allowlist (`src/lib/editor/e2e/a11y/axe-baseline.json`). That allowlist is the executable, milestone-tied log of deferred AA work (contrast → CSS-ownership migration; per-block accessible names + the focusable thematic-break separator → 1.1) and only shrinks. The cross-block selection — overlay-painted with native selection suppressed, so otherwise invisible to assistive tech — is exposed through a visually-hidden `aria-live` region fed by the pure `createSelectionDescription` builder.

## Foundation (Phase 1, landed)

- `BLOCK_KIND_TABLE` / `ALL_BLOCK_KINDS` — union-derived kind manifest (`core/nodes.ts`).
- `assertInvariant` — dev-runtime channel, dev-warn-decoupled (`invariants/assert.ts`).
- fast-check harness + `test:editor:invariants` script.
