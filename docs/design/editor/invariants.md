# Editor Invariants — Catalog & Enforcement

Living reference for the editor's load-bearing invariants and how each is enforced. Design rationale and full row detail: `docs/superpowers/specs/2026-06-06-loud-invariants-design.md`.

**Enforcement codes:** A = runtime DEV assertion · P = property test (fast-check) · N = negative fixture · T = compile-time type guard · L = lint/source-scan · D = doc.

Predicates live in `src/lib/editor/invariants/`; property tests + arbitraries in `src/lib/editor/test/invariants/` (`npm run test:editor:invariants`). The Group 2 predicates are **test-only** and must never be exported through `src/lib/editor/index.ts` (it would add a `→ selection` edge to the runtime DAG). The "Predicate / Seam / Test" cells fill in as each enforcing phase lands.

## Group 1 — Runtime-checkable (A·P·N)

| ID | Invariant | Codes | Predicate / Seam / Test |
| --- | --- | --- | --- |
| G1.1 | Container raw not stale: `strip(raw) === serialize(children)` (table/grid exempt) | A·P·N·D | Phase 3 |
| G1.2 | Registry completeness: every `BlockKind` → descriptor + component | A·P | Phase 3 |
| G1.3 | `isContainer` iff `rebuildRaw` (post-augment) | A·P·N | Phase 3 |
| G1.4 | No container `setContext`s `HISTORY_KEY` | A·L·N | Phase 3 |
| G1.5 | Category↔field legality (leaf/prose/container fields; valid `mergeRole`) | A·P·N | Phase 3 |
| G1.6 | `cloneMetadata` clone-safety | A·P | Phase 3 |
| G1.7 | Metadata-driven-raw writes go through `updateBlockMetadata` | A·N | Phase 3 |
| G1.8 | `getContentRange` well-formed per prose kind | A·P·N | Phase 3 |

## Group 2 — Property/regression-tested (P·N)

| ID | Invariant | Codes | Test |
| --- | --- | --- | --- |
| G2.1 | Round-trip + parser totality over arbitrary strings | P·N | Phase 4 (seed: `test/invariants/round-trip-smoke.test.ts`) |
| G2.2 | EOF edge states round-trip (unclosed fence, unterminated HTML) | P·N | Phase 4 |
| G2.3 | Inline conformance corpus | P | Phase 4 |
| G2.4 | `textContent === ambientPrefix + raw` spine (jsdom) | P | Phase 4 |
| G2.5 | Inline-tree offset partition | P·N | Phase 4 |
| G2.6 | Serialization purity (ignores inlineContent/metadata) | P | Phase 4 |
| G2.7 | Selection partition + `walkBetween` order | P | Phase 4 |
| G2.8 | Split/merge round-trip + id↔ref↔children alignment (all scopes) | P·N | Phase 5 |
| G2.9 | Paste op-kind dual-emit | P | Phase 5 |
| G2.10 | Sticky-column matrix + capture-without-reset guard (jsdom) | P·A | Phase 5 |

## Group 3 — Compile-time type guards (T)

| ID | Guard | Retires | Phase |
| --- | --- | --- | --- |
| G3.1 | `BlockMetadataByKind` + `metadataOf<K>` | `as` metadata casts | Phase 2 |
| G3.2 | `defineBlockComponent` | `as unknown as` casts | Phase 2 |
| G3.3 | Discriminated `SelectionPoint` | char-vs-cell `offset` overload | Phase 2 |
| G3.4 | Branded `CURSOR_END` / `SELECTION_END` | `999999` magic number | Phase 2 |
| G3.5 | `containerContract: 'strip' \| 'grid'` | implicit table exemption | Phase 2 |

## Group 4 — Lint/structural + harness

| ID | Invariant | Codes | Phase |
| --- | --- | --- | --- |
| G4.1 | No by-value `createBlockListState` (getters only) | L | Phase 5 |
| G4.2 | No `.inlineContent` read in the render path | L | Phase 5 |
| G4.3 | Container-author conformance kit | harness | Phase 5 |
| G4.4 | No timing hacks for sequencing (rAF allowlisted in `selection/`) | L | Phase 5 |

## Foundation (Phase 1, landed)

- `BLOCK_KIND_TABLE` / `ALL_BLOCK_KINDS` — union-derived kind manifest (`core/nodes.ts`).
- `assertInvariant` — dev-runtime channel, dev-warn-decoupled (`invariants/assert.ts`).
- fast-check harness + `test:editor:invariants` script.
