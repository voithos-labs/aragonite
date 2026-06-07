# Editor Invariants — Catalog & Enforcement

Living reference for the editor's load-bearing invariants and how each is enforced. Design rationale and full row detail: `docs/superpowers/specs/2026-06-06-loud-invariants-design.md`.

**Enforcement codes:** A = runtime DEV assertion · P = property test (fast-check) · N = negative fixture · T = compile-time type guard · L = lint/source-scan · D = doc.

Predicates live in `src/lib/editor/invariants/`; property tests + arbitraries in `src/lib/editor/test/invariants/` (`npm run test:editor:invariants`). The Group 2 predicates are **test-only** and must never be exported through `src/lib/editor/index.ts` (it would add a `→ selection` edge to the runtime DAG). All phases have landed; the tables below map each invariant to its predicate file, enforcing seam, and test file (file-level references — not line numbers, which drift).

## Group 1 — Runtime-checkable (A·P·N)

Seams: commit primitive = `invariants/install.ts` `assertCommittedNodes`, invoked from `editor-actions/undo-controller.ts` after each commit's raw rebuild. Bootstrap = `invariants/install.ts` `runStartupInvariantChecks`, invoked once from `Editor.svelte` after built-in registration.

| ID | Invariant | Codes | Predicate · Seam · Test |
| --- | --- | --- | --- |
| G1.1 | Container raw not stale: `strip(raw) === serialize(children)` (grid containers exempt) | A·P·N·D | `node-shape.ts` `checkStaleRaw` · commit primitive · `stale-raw.test.ts` |
| G1.2 | Registry completeness: every `BlockKind` → descriptor + component | A·P | `registry.ts` `checkRegistryCompleteness` · bootstrap (+ BlockHost visible-raw fallback for `listItem`) · `registry.test.ts` |
| G1.3 | `isContainer` iff `rebuildRaw` (post-augment) | A·P·N | `registry.ts` `checkIsContainerIffRebuildRaw` · bootstrap · `registry.test.ts` |
| G1.4 | No container `setContext`s `HISTORY_KEY` | A·L·N | `context-keys.ts` · `editor-actions/nested-actions.ts` `setNestedActionsContexts` · `context-keys.test.ts` |
| G1.5 | Category↔field legality (leaf/prose/container fields; valid `mergeRole`) | A·P·N | `node-shape.ts` `checkCategoryFields` · commit primitive · `category-fields.test.ts` |
| G1.6 | `cloneMetadata` clone-safety | A·P | `node-shape.ts` `checkCloneSafeMetadata` · `tree-operations/clone.ts` `cloneNode` · `clone-safe-metadata.test.ts` |
| G1.7 | Metadata-driven-raw writes go through `updateBlockMetadata` | A·N | (no dedicated predicate) · `editor-actions/block-edit.ts` `updateBlockMetadata` rebuilds raw after the merge · `editor-actions/update-block-metadata.test.ts` (G1.1 stale-raw is the runtime backstop for bypasses) |
| G1.8 | `getContentRange` well-formed per prose kind | A·P·N | `descriptor.ts` `checkContentRange` · commit primitive · `descriptor.test.ts` |

## Group 2 — Property/regression-tested (P·N)

Test files under `test/invariants/` (arbitraries in `test/invariants/arbitraries/`).

| ID | Invariant | Codes | Test |
| --- | --- | --- | --- |
| G2.1 | Round-trip + parser totality over arbitrary strings | P·N | `round-trip.property.test.ts` |
| G2.2 | EOF edge states round-trip (unclosed fence, unterminated HTML) | P·N | `round-trip.property.test.ts` (G2.2 block) |
| G2.3 | Inline conformance corpus | P | `inline-conformance.property.test.ts` |
| G2.4 | `textContent === ambientPrefix + raw` spine (jsdom) | P | `textcontent-spine.property.test.ts` |
| G2.5 | Inline-tree offset partition | P·N | `inline-offsets.property.test.ts` |
| G2.6 | Serialization purity (ignores inlineContent/metadata) | P | `serialization-purity.property.test.ts` |
| G2.7 | Selection partition + `walkBetween` order | P | `selection-partition.property.test.ts` |
| G2.8 | Split/merge round-trip + id↔ref↔children alignment (all scopes) | P·N | `structural-id-ref-alignment.test.ts` |
| G2.9 | Paste op-kind dual-emit | P | `paste-op-kind.test.ts` |
| G2.10 | Sticky-column matrix + capture-without-reset guard (jsdom) | P·A | `sticky-column-matrix.test.ts`, `lint/sticky-column-capture-reset.test.ts` |

## Group 3 — Compile-time type guards (T)

All landed. Guards are enforced by the type checker (`npm run check`); no runtime seam.

| ID | Guard | Retires | Status |
| --- | --- | --- | --- |
| G3.1 | `BlockMetadataByKind` + `metadataOf<K>` | `as` metadata casts | landed |
| G3.2 | `defineBlockComponent` | `as unknown as` casts | landed |
| G3.3 | Discriminated `SelectionPoint` | char-vs-cell `offset` overload | landed |
| G3.4 | Branded `CURSOR_END` / `SELECTION_END` | `999999` magic number | landed |
| G3.5 | `containerContract: 'strip' \| 'grid'` | implicit table exemption | landed |

## Group 4 — Lint/structural + harness

All landed. Source-scan tests live under `test/invariants/lint/`.

| ID | Invariant | Codes | Test |
| --- | --- | --- | --- |
| G4.1 | No by-value `createBlockListState` (getters only) | L | `lint/createblockliststate-getters.test.ts` |
| G4.2 | No `.inlineContent` read in the render path | L | `lint/render-inlinecontent.test.ts` |
| G4.3 | Container-author conformance kit | harness | `container-conformance.test.ts` (kit: `container-conformance-kit.ts`) |
| G4.4 | No timing hacks for sequencing (timing primitives allowlisted) | L | `lint/timing-hacks.test.ts` |

G4.4 allowlist (the only sanctioned timing primitives — anything else trips the scan): rAF throttles in `selection/autoscroll.ts` (frame-paced autoscroll), `selection/drag-pointer.ts` and `components/blocks/table/cell-pointer.ts` (pointermove coalescing during drag); plus the `setTimeout` wall-clock undo debounce in `editor-actions/undo-controller.ts` (a tick-grained microtask can't express a "user stopped typing" pause).

## Foundation (Phase 1, landed)

- `BLOCK_KIND_TABLE` / `ALL_BLOCK_KINDS` — union-derived kind manifest (`core/nodes.ts`).
- `assertInvariant` — dev-runtime channel, dev-warn-decoupled (`invariants/assert.ts`).
- fast-check harness + `test:editor:invariants` script.
