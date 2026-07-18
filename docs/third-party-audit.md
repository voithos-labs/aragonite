# Third-Party Audit — 0.9.28

An outside review of aragonite conducted 2026-07-18 against commit `07676dd2` (v0.9.28, branch `dev`), by an agent with no prior knowledge of the project and no contact with the author. Nothing was fixed; nothing was committed. The working tree was clean before and after.

**Standing.** This is a dated snapshot, not living documentation — it pins specific numbers, commits, and file positions on purpose, because a finding without reproducible evidence cannot be falsified. It goes stale by design. Treat it the way `test/perf/baseline.json` is treated: valid for the commit it names, re-measured or discarded rather than edited.

**Confidence marking.** Findings marked **[v]** were reproduced directly — command run or source read by the auditor. Findings marked **[d]** come from delegated sub-audits and were not independently re-verified; they are the weaker claims here and are flagged as such.

## Method

Docs were read first, then treated as a set of falsifiable claims and checked against source. Everything below is reproducible:

| What                        | Command                                                  | Result                             |
| --------------------------- | -------------------------------------------------------- | ---------------------------------- |
| Unit suite                  | `npx vitest run`                                         | 4,204 passed, 2 skipped, 451 files |
| Invariant suite             | `npx vitest run src/lib/test/invariants`                 | 426 passed, 53 files               |
| GFM conformance, full sweep | `CONFORMANCE_FULL=1 npx vitest run …/full-sweep.test.ts` | 182,160 inputs compared            |
| Simulation oracle           | `npx playwright test --project=e2e-simulation`           | 17/17 on the re-run (see appendix) |
| Library build               | `npm run build`, `npm run package`                       | both green                         |

Not run: the full e2e battery, the perf gate, a11y and VR projects. Conclusions about interaction correctness rest on the simulation slice plus source reading, not on the whole battery.

## Verdict

The engineering is not this project's risk. The two things that decide its fate — whether the plugin API is right, and whether anyone wants the product — are untouched by how well it is built, and the first of those is scheduled to freeze before the mechanisms designed to test it exist.

Stated as a shape: **the codebase has the discipline of a mature, widely-depended-on library and the user base of a prototype.** That inversion is the finding. Everything below either supports it or qualifies it.

## Claims that held

An adversarial pass over the docs' load-bearing claims found no substantive overstatement. Selected checks:

| Claim                                                           | Verdict                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `serialize(parse(s)) === s`, serializer is pure concatenation   | **[v]** Holds. `core/serializer.ts` is 22 lines, no recursion. Round-trip property green over 4,000 fast-check cases including CRLF, deep nesting, and adversarial floods                              |
| Parser is total; paragraph is the fallback                      | **[v]** Holds. `core/parser.ts` is 179 lines of dispatch; every line an opener declines is absorbed                                                                                                    |
| `unrecognized` is reserved and never parser-emitted             | **[d]** Holds. No parser path emits it                                                                                                                                                                 |
| Dev assertions tree-shake to nothing in production              | **[d]** Holds, checked empirically against a real production client bundle: zero assertion tags, predicate names, or message literals survive                                                          |
| Invariant catalog entries name a real predicate, seam, and test | **[d]** 22 guards checked across all four groups, three legs each. No drift, no vestigial guards. Several lint tests are _stronger_ than documented (non-vacuity self-tests, dead-allowlist detection) |
| 8-gate paste dispatcher, in the documented order                | **[d]** Exact 1:1 match                                                                                                                                                                                |
| Merge-role table (editor.md §8)                                 | **[d]** All 14 kinds match the descriptors                                                                                                                                                             |
| Fenwick height model, absolute-index contract                   | **[d]** Real, and honored by all three windowed consumers                                                                                                                                              |
| Keystroke latency is O(viewport)                                | **[v]** Gated baseline shows p50 2.7–4.4 ms across every document shape from 100 KB to 10 MB                                                                                                           |

Two results deserve emphasis because they are unusually strong.

**Conformance.** The full sweep compares 182,160 inputs against commonmark.js 0.31.2 and diverges on 422 — about 0.23%. Every one of the 416 divergences the baseline does not name by exact string contains an astral-plane character: the documented class where aragonite classifies flanking punctuation by code point per spec while the reference reads UTF-16 units. That is a case of being _more_ correct than the reference implementation, recorded with its reasoning rather than quietly enjoyed. **[v]**

**The hard part is done properly.** Inline emphasis is where Markdown parsers fail. The scanner implements the real delimiter-run algorithm — left/right flanking, `canOpen`/`canClose`, `openers_bottom` bucketing, and the multiple-of-3 rule on original run lengths. This is a faithful port, not an approximation. **[v]**

## Findings

Ordered by how much they should change a decision, not by severity label.

### 1. The plugin API is freezing on first-party evidence only, and before its own gap detector

**The contradiction is internal to the plan, in the project's own words.**

- The freeze criterion (`design/plugin-contract.md`) requires validation by two container consumers, the in-repo dogfood extensions, and an internal limestone integration. **All of these are authored by the project owner.** The only out-of-repo artifact is a type-level probe explicitly marked as not called at runtime.
- The entire DX system — scaffold, hot-reload loop, reference-plugin fleet, docs site, plugin DX test suite — is scheduled at **1.2, after the freeze**.
- The roadmap names 1.3's reference plugins (footnotes, emoji, autolinks) as the gap detector and states the remedy: _"If any can't be built cleanly as a plugin, that reveals an API gap — fix the API, not the plugin."_ By 1.3 the API is frozen. **The stated discovery mechanism runs two milestones after the last point at which its discoveries could be acted on.**

For a project whose stated moat is plugin DX, this is the highest-stakes open item in the repo. **[v]** on the roadmap/contract reading; **[d]** on the survey of validation artifacts.

**Fix direction.** Either move the freeze later, or pull the 1.3 reference plugins and one genuinely external author in front of it. An outside developer building one block kind with no assistance, with their friction log treated as blocking, is the single highest-yield action available.

### 2. The `closure` block taxes every author certainly and guarantees conditionally

The forcing function is a genuinely novel idea — nothing in ProseMirror, CodeMirror 6, Tiptap, or Obsidian makes an author state what happens to their node under undo, clipboard, or search — and it is aimed at a real incident (0.9.18). The concern is the ratio.

- The simplest possible plugin block, `toc` (matches one literal string, no metadata, no container), spends **32 lines of its ~43-line `registerBlockKind` call on the closure block**. **[v]**
- Of nine columns, **two** get bootstrap coherence checks (G1.24: container `roundTrip`, `not-mergeable` `mergeBackspace`). **[d]**
- Four columns are never headlessly executable, per the conformance kit's own table. **[d]**
- The `via` field is free text. `schema/closure.ts` names its enforcement: _"Honesty rule (enforced by review)"_ — a mechanism third-party authors do not have. **[d]**

The shipped `via` strings show the shape of the problem: several read _"under the `[invariant:]` watcher"_, which is meaningless to an author who has no such watcher, yet the field is mandatory.

**Fix direction.** A `LEAF_DEFAULT_CLOSURE` preset for simple kinds — the pattern already exists internally as `RAW_TEXT_LEAF_CLOSURE` and is simply not exposed — keeping the full nine-column requirement for containers and novel tiers, where the 0.9.18 lesson actually applies.

### 3. The property suite's oracles are blind to the bug class its inputs target

The sharpest technical finding, and it was proven rather than argued. **[d]**

The arbitraries are genuinely adversarial: CJK, combining marks, emoji, ZWJ clusters, and astral punctuation, the last with an explicit comment that flanking must classify by code point rather than UTF-16 unit. But when that exact astral handling was deliberately broken, **every property test passed.** The failures came from hand-written units and the commonmark differential.

The reason is structural, not incidental. The properties assert byte conservation and offset tiling — `textContent === ambientPrefix + raw`, inline nodes tiling their range without gaps. Both hold perfectly when emphasis is classified _wrongly_: the bytes still tile, they are merely under the wrong node kinds. The adversarial Unicode therefore does not earn its keep against semantic misclassification; that work is done entirely by the differential and the hand-written conformance units.

Secondary: every `fc.assert` file uses a fixed seed, so the suite has deterministic CI and zero new-input discovery over time.

**Fix direction.** Add a property whose oracle is node kinds and nesting rather than bytes, over the existing inline-source arbitrary. Consider one CI lane on a rotating seed.

### 4. Static analysis is doing less work than the discipline implies

`npm run lint` is `prettier --check` plus the docs-pack link check. **There is no ESLint, and no eslint dependency in the tree.** **[v]**

Type checking (`svelte-check`) and 22 hand-written source-scan lint tests do real work, and several of those lints are cleverer than an off-the-shelf rule would be. But for ~49k lines of TypeScript, the standard net — floating promises, exhaustive switch discipline, unused-value rules — is absent. This sits oddly beside a project whose stated ladder is _unrepresentable > guarded > documented_: ESLint is a cheap rung that is simply not installed.

Related, and milder than first assumed: the codebase carries **55 "mirrors X / parity with Y" comments** in non-test source against **22 source-scan lint tests**. **[v]** The parallel-path obligation is real and the project has named the bug class ("sibling-path parity"), but the automated net is denser than a first pass suggests.

### 5. "Adding a block type is boring" is half-true, and the honest version is already in the README

The literal claim holds and is impressive: **no core file dispatches on any plugin's kind string.** **[d]** Registries genuinely eliminated name-dispatch.

The implied claim does not. Commit `95f13e07` widened `schema/merge-rules.ts`, `schema/block-kind-descriptor.ts`, and `schema/reserved-chrome.ts` — core files — specifically so the `details` plugin could collapse. **[v]** The registry converts _grow a case for the NAME_ into _grow a branch for the FIELD_.

The discriminator is not project maturity; it is whether a new kind is a variation on an existing capability (cheap) or introduces a novel one (core surgery, every time). To the design's credit, collapse landed as a declarative descriptor probe rather than a kind check, so every future collapsible container inherits it. But `design/editor.md`'s "if it requires touching the editor shell… that's a coupling problem" overstates what history shows. `README.md` already carries the accurate version — that shipping a kind "forces the boring questions up front."

### 6. Documentation decays faster than the link discipline covers

`docs/research/architecture-concerns.md` was deleted in `2b78ae15` ("deleted stale architecture concerns doc") on 2026-07-17. **21 references to it survive** across `docs/README.md`'s own index table, `design/syntax-tree.md`, `design/performance.md`, `roadmap.md`, `changelog.md`, and fifteen source files. **[v]**

Two of those are load-bearing: `syntax-tree.md` and `performance.md` both cite it as the durable record for the container-raw redundancy decision. The rationale is partly inlined at both sites, so nothing is lost outright — but the "durable record" the changelog promises is gone.

The link-closure lint cannot catch this: it scopes to `docs/guide/` by design, because the pack ships flat. Small as a defect; useful as a signal about a ~4,800-line doc corpus maintained by one person.

**Fix direction.** Either restore the doc or sweep the references. Consider extending the link check to all of `docs/` with an allowlist, since the guide-only scope leaves the design docs unguarded.

### 7. Localized code weaknesses

Each is contained and none is a live defect:

- **`selection/range-delete-table.ts`** is the roughest file in the tree. Post-delete survivors are located by a **recursive full-tree identity scan**, called up to several times per cross-block table delete. **[v]** The comment explains the tradeoff (identity over index arithmetic) and it is a correctness-first choice on a cold gesture — but it is an ungated O(nodes) cost in a project whose headline differentiator is large-document scale, and the keystroke gate cannot see it. The file also triplicates a ~60-line ceremony across three cross-block cases with load-bearing ordering differences, which its own comments acknowledge. **[d]**
- **The commit ceremony's rollback is convention, not compiler.** Recovery state spans six manual registers. Each is correct and explained; nothing forces the seventh piece of state a future change adds to acquire one, and a missed register corrupts undo silently. **[d]**
- **The reveal/fold machine** encodes its state in eight loose mutable variables with three exit paths that each clear a different subset, and no canonical reset. Bounded rather than leaking, but a fourth exit path has no teardown to call. **[d]**
- **Components are covered by e2e, essentially not by unit tests** — of 22 Svelte components, two are ever mounted in a unit test. Defensible for DOM- and selection-dependent surfaces; the cost is that component regressions have only slow, browser-dependent feedback. **[d]**

### 8. The losslessness headline carries an asterisk

`load → save` is byte-exact. `load → edit → save` is not universally: a GFM body row wider than its header drops the surplus cells on first table edit, as `docs/issues.md` records with full reasoning — the bytes were never in the model, GFM mandates ignoring them, and preserving them would require either phantom children or a `raw` that disagrees with `children`.

The classification is defensible and the reasoning is sound. The note here is only that the promise a reader takes from the README ("what you save is what you authored") is narrower than it sounds once editing enters, and the asterisk lives in the issue ledger rather than beside the claim. **[v]**

## What this audit could not assess

The evidence base is entirely internal to the repository. This audit can speak to whether aragonite is well built. It cannot speak to:

- **Whether the product bet lands.** Byte-lossless round-tripping is an engineering virtue users do not directly perceive. The default view is monospace styled source with visible markers — the most Markdown-native of the available options, mitigated but not replaced by the presentation modes.
- **Whether the API is pleasant in the hands of someone who did not build it.** No external author has used it. That is finding 1 restated as a limit.
- **Interaction correctness at large.** The full e2e battery, perf gate, a11y and VR projects were not run.
- **Sustainability.** 1,764 of 1,767 commits are by one author over four months. The docs are a serious mitigation and the culture rules are written down. Whether they transfer is unproven, and the contributor on-ramp pass is still a roadmap item.

## Appendix — an auditor error, recorded

The simulation battery was first run **concurrently** with four other agents reading the same tree. It reported 6 failures, including three multi-seed fuzz seeds and the merge-reachability spec.

All six were artifacts. Every "source mismatch" failure showed the editor holding a **correct parse of the showcase document** where the oracle expected a seeded note — page state, never CST corruption. The merge failure was `[invariant:late-opener-registration]` firing for _built-in_ openers, i.e. the dev server re-evaluating registrar modules after parse. Re-run serially in isolation: **17/17, exit 0.**

`CONTRIBUTING.md` states the rule that was broken: _"long batteries run alone, never concurrently with other work on the same tree; contention produces phantom failures that cost real investigation time."_ The rule is correct, the failure mode is exactly as documented, and the cost was as advertised.

Miss-analysis, in the house style: the auditor read the rule before running the battery and did not apply it. Recorded because an audit that hides its own false positives is worth less than one that does not — and because it is the strongest available evidence that the phantom-failure class this project warns about is real.
