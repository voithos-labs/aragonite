# Architecture concerns — the standing eyebrow list

Five designs flagged in a post-0.9.26 architecture review as questionable, each with the
evidence, the counterweight, and a direction. This is a **record of concerns, not a defect
ledger** (defects go to `docs/issues.md`) — every entry is a working design whose _shape_ may
be wrong, cheap to reconsider now and expensive after the 1.0 freeze. The pre-1.0
architecture-concern pass (`docs/roadmap.md`) addresses or explicitly re-affirms each; an
entry leaves this list only with a decision recorded against it.

## 1. Process-global registries compound their costs

**The design.** Kind definitions (descriptors, components, openers, commands, paste surfaces)
are process-global, register-once, no unregister — the `customElements` model. A plugin
registering an opener teaches the parser process-wide, for every editor instance.

**The concern.** The escape hatches keep accumulating: `resetPluginPlatformForTests` exists
because test suites chafe; HMR of a registration module needs a full page reload; the SSR
registrar-poison dev-server class (`docs/issues.md`) exists because vite invalidates modules
while registry instances persist — and it produced a real phantom failure during the 0.9.26
work; per-instance _enablement_ is impossible without a future policy layer; and the pattern
self-reinforces (the 0.9.25 interaction trace went module-global too, because that is the
house default). A design that needs four compensating mechanisms and still generates phantom
failures is paying rent the docs don't fully acknowledge.

**The counterweight.** The model is coherent (a kind is a definition, like a custom element),
it made register-once/conflict-on-duplicate trivially enforceable, and no real consumer has
yet hit the multi-editor wall.

**Direction.** Build the fix before limestone binds (owner-directed, build-up-front posture):
an instance-resolution seam over global definitions — definitions stay the global cache,
each instance resolves through a view whose default is "all definitions" (behavior-preserving),
enablement becomes an additive policy knob, and the operational rot (test resets, HMR reloads,
SSR registrar poison) gets a structural fix instead of a fourth compensation. Limestone then
integrates against the fixed shape and pressure-tests it, rather than binding to the suspect
one while "validating" it.

## 2. `SelectionPoint.offset` carries two coordinate spaces in one field

**The design.** `offset: number` means a character offset into a leaf's `raw` — unless
`cellCoordinate: true`, in which case it means a row-major table cell index.

**The concern.** A numeric field whose meaning is discriminated by an optional boolean is the
numeric cousin of stringly-typed. The 0.9.24 brands pass identified it precisely ("one field,
two spaces"), then built guarded accessors (`charOffsetOf`/`cellIndexOf`) _around_ the shape
because it is public — meaning the wart is on track to freeze at 1.0.

**The counterweight.** The accessors plus the `CellIndex` brand make internal misuse a compile
error today; only the public shape stays loose.

**Direction.** **Fix pre-freeze — this is the cheapest and most clearly justified of the five.**
By the contract's own breaking-if-deferred criterion, a public shape consumers will bind
belongs settled before the freeze: a discriminated point union (`{ path, offset }` |
`{ path, cell }`) or an equivalent shape that cannot be misread. Costs a bounded churn through
`selection/` now; costs a major version later.

**Resolution (0.9.27 — FIXED).** `SelectionPoint` became a discriminated union —
`CharSelectionPoint | CellSelectionPoint` on `cellCoordinate` — with `offset` keeping its name on
both arms (renaming it to `cell` would be the gratuitous break the "equivalent shape" clause left
open). The teeth are on construction: a cell point needs the literal `cellCoordinate: true` and a
char-typed slot rejects a cell point, so every cell mint (arm-typed or `satisfies`-checked) and the
undo copy path preserve the variant at the type level while every consumer reading `.offset` compiles
unchanged (`highlight-occurrences`
and `ghost-text` are the source-compat proof). Reading `offset` in the wrong space is _not_ a
compile error — `offset` is shared — so that check stays the `charOffsetOf`/`cellIndexOf` runtime
DEV-warn belt; the shape is settled, not made unmisreadable. Intra-table selections keep their
deliberate exemption, trafficking in cell-valued offsets on unflagged points by shared-scope
convention, now documented on the union type. G3.3 in `invariants.md` records the real compile-time
union — it previously overclaimed the 0.9.24 accessors as one.

## 3. The flat `CstNode` interface inverts the enforcement ladder at the core type

**The design.** `CstNode` is one flat interface with optional fields, not a discriminated
union, so the editor can reassign `kind` in place; `metadata` is narrowed manually after a
kind check.

**The concern.** "Unrepresentable > guarded > documented" is the house rule, yet at the most
load-bearing type the choice was _guarded_ — `metadataOf<K>` casts and a family of G-guards do
what a union would give for free. And the stated justification has internal tension:
`editor.md` §8 says a kind change **replaces the node object** ("keeps its ID; only the node
object is swapped"), which is exactly what a union needs. If some re-parse-transfer path
genuinely mutates `kind` in place, that path is one funnel that could own an internal cast
while the union holds everywhere else.

**The counterweight.** The flat interface is simple, uniform across parser/editor/serializer,
and the guards do hold — no metadata-shape corruption has shipped.

**Direction.** Attempt the union — the `kind`-write-site survey is step one of the attempt,
not a separate phase. Enumerate every site that writes `node.kind` (cheap post-brands),
determine whether in-place reassignment is real or vestigial, and adopt the union with one
sanctioned transfer funnel; a concrete recorded blocker is the honest failure mode. Readonly
views (0.9.24) already carved the mutation perimeter, which makes the attempt far cheaper than
it was.

**Resolution (0.9.27 — FIXED).** `CstNode` is a discriminated union: a per-kind arm for each
built-in block (metadata typed to the kind; leaf arms pin `children`/inner fields `undefined`,
so G1.5's leaf-field ban is now unrepresentable, not guarded; container structural fields stay
optional for transient childlessness) plus one open `PluginBlockNode` arm. The scout's survey
held: the ONLY in-place `node.kind =` write was `updateNodeContent`'s re-parse transfer, and it
was vestigial — its kind-change and multi-block paths now mint a fresh node and splice it into
the slot (the same shape split/merge always used), while a same-kind edit keeps its in-place
field write so routine typing preserves the node object, its component, IME state, and inline
cache. That mint is the single sanctioned transfer funnel. The union type does not itself forbid
an in-place `node.kind =` on a mutable node — union-write permits it; the door is closed reader-side,
where every reader holds a bytes-readonly `NodeView` whose `kind` is a compile error to write, plus
funnel discipline in the mutation layer.

The plugin arm's branded-string `kind` is not a unit type, so it blocks discrimination on the
FULL union — `isBuiltinBlockNode` narrows to the built-in sub-union first, and there
`switch (node.kind)` types each arm's metadata for free. `metadataOf` therefore stays as the one
sanctioned narrowing home for the un-narrowed and generic contexts the branded arm keeps
un-narrowable (its body's cast survives for the generic path). This revises the pre-attempt
estimate that "most sites simplify": the sweep collapsed the one genuine `switch (node.kind)`
metadata cluster (the debug dump reads each arm directly now) and kept `metadataOf` at the ~90
contextual call sites, where the kind is known by position rather than a narrowing check — an
honest, small collapse ratio, not a shortfall. `BytesView` distributes over the union, so
`NodeView` discriminates natively too. Runtime-kind construction routes through `makeBlockNode`,
which spreads into a fresh object (so it cannot strip a view — no G1.9 hazard) and is the one
cast G4.13 sanctions in `core/nodes.ts`. The enforcement climbed from guarded to unrepresentable
for construction and for built-in narrowing; the residual `metadataOf` funnel is the honest
floor the open plugin arm imposes, now documented rather than worked around.

## 4. Container `raw`/children redundancy is the most guard-hungry decision in the repo

**The design.** A container's `raw` holds the whole subtree's source; children hold inner
slices; the two are redundant, reconciled by `rebuildRaw` dispatched up the ancestry after
every inner edit. The serializer never recurses.

**The concern.** Count what exists solely to defend the redundancy: G1.1 stale-raw, the
opaque-staleness and rebuild-determinism probes, ancestry dispatch, the container-raw
amplification perf ceilings, search's containers-are-skipped special case. The alternative —
containers serialize from children, storing per-line prefix info for byte fidelity — would
delete that entire invariant family at the cost of a recursive serializer. Deep nesting pays a
permanent write-amplification tax.

**The counterweight (and why the review landed ~60/40 in the design's favor).** Exotic
container chrome (irregular `> ` spacing, mixed indentation) makes per-line prefix storage
converge back toward storing the raw anyway; the trivially-auditable serializer has real
value; and the amplification is measured and ceiling-gated, not open-ended.

**Resolution (0.9.27 — EXONERATED).** The falsification benchmark was built and clears the
design. `container-raw.bench.ts` gained a combined depth × bytes axis over a new
`generateDeepNested` fixture — every ancestor level carries substantial sibling raw, so the
outermost container materializes the whole subtree — and it drives the shipped
`rebuildUnsharedChain`, the exact function the routine-typing path calls. Per-keystroke
ancestry rebuild, mean ms (vitest/Node, DEV assertions off — production-representative):

| depth ↓ / per-level → | 1 KB  | 10 KB | 50 KB |
| --------------------- | ----- | ----- | ----- |
| 4                     | 0.004 | 0.015 | 0.25  |
| 8                     | 0.010 | 0.052 | 0.93  |
| 12                    | 0.019 | 0.11  | 1.83  |

Redundant-storage amplification tracks chain-depth ÷ 2 (×3.5 at depth 4, ×6.5 at 8, ×9.5 at
12). Past the realistic envelope, the adversarial depth 16 × 100 KB corner costs 5.5 ms
(reported, not judged). The realistic envelope is **depth ≤ 10, per-level ≤ 50 KB** — 50 KB of
sibling content at each of ten nested levels is already half a megabyte in one subtree, past
any document a human writes. (Per-level figures are nominal byte targets; the ASCII corpus
under-fills them ~12%, so each measured point sits marginally below its label — conservative
for the verdict.)

Why a microbench settles an e2e-phrased claim: a top-level keystroke skips the ancestry
rebuild entirely, so a nested keystroke on a same-sized leaf is exactly _floor +
rebuild(depth, bytes)_ — the rebuild is the whole delta from the floor. At the realistic worst
corner that delta is a small single-digit-millisecond term (~1–2 ms), so the shipped keystroke
stays in the viewport-bounded floor class (~2–4 ms) and never nears the pathological class
(single-giant-paragraph, 177 ms @ 1 MB). The report-only at-depth e2e row
(`typing-latency.perf.spec.ts`) corroborates in the browser: typing into the depth-8 × 50 KB
leaf drives exactly one full depth-13 rebuild and only **two** block renders per keystroke — no
cascade, no scaling with document size. Its p50 (~16 ms) is a DEV-plus-harness-quantized upper
bound, not a profiled production latency: the settle poll runs on a 16 ms cadence
(`waitForBlock0Len`, `polling: 16`), so a commit landing just after a poll snaps to the next
tick, and the number was never decomposed into rebuild-vs-render-vs-DEV cost. The verdict does
not rest on it — it rests on the production-representative bench rebuild term (~0.9 ms) and the
measured O(1) render count, which together leave no identified production mechanism for a
depth-specific cost beyond the sub-2 ms rebuild. The measured worst case is stated in
`syntax-tree.md` beside the container-contract rationale. The redundancy stays; the gate found
no user-facing indictment.

## 5. Svelte context-key sprawl

**The design.** The block↔editor interface rides a growing set of context keys — four action
sub-bundles plus `CONTROLLER_KEY`, `PASTE_COORDINATOR_KEY`, `HISTORY_KEY`,
`IMAGE_LOAD_POLICY_KEY`, `FOCUSED_PATH_KEY`, and now `PRESENTATION_MODE_KEY`.

**The concern.** Context is invisible in signatures, and the surface grows by one key per
feature. The tell arrived during 0.9.25: mounting one `CodeBlock` in a unit test required
stubbing **thirteen** context keys. Two lints (G1.4, G4.1) already exist to police
context-related discipline — guards accreting around an interface is the same smell as
entry #1.

**The counterweight.** Per-key granularity is what lets a container override exactly the
bundle it changes with zero pass-through boilerplate — a real, load-bearing property of the
nested-container design.

**Direction.** Consolidate into fewer, named facets — the same shape as the freeze-cut's
pending "group `BlockComponent`'s optional capability probes into named facets" decision;
treat the two as one design question and attempt both in the architecture-concern pass
(byte-identical refactor discipline, the edge-policy consolidation precedent). A mount-harness
helper supplying the standard stub set relieves the test-cost symptom regardless of where the
interface lands.
