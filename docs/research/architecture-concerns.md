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

**Direction.** A falsification gate, not a deferral: build the deep-nesting amplification
benchmark first, as a real artifact over realistic workloads. If the data indicts the design,
fix it in the architecture-concern pass — before limestone. If it exonerates, state the
measured worst case in `syntax-tree.md` beside the rationale and record the decision here.
Either way the verdict is earned by numbers, not momentum.

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
