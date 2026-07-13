# Plugin-System Prior-Art Research — Decision Report

**Date:** 2026-07-01
**Source:** prior-art survey of ProseMirror, Milkdown/TipTap, Lexical, CodeMirror 6, VS Code, and Obsidian, plus an internal review of the current surface and invariant boundaries, with an adversarial critique pass over the synthesis.
**Status:** research input for the pre-freeze plugin-authoring contract decision. Not a plan.
**Frame honored:** maximize _expressiveness within the lossless-CST invariants_, not raw flexibility.

---

## Verification note (2026-07-01)

The synthesis and its adversarial critique were re-checked against code. **Verified true:**

- `registerInlineWidgetKind` (`src/lib/core/inline/inline-widgets.ts:27`) is a bare `registry.set` with **no duplicate guard** — a plugin silently clobbers the built-in `image`/`rawHtml` widget process-globally. Contrast `registerBlockKind` (`src/lib/schema/block-kind-descriptor.ts:163`), which throws. **P0 leak confirmed.**
- `augmentBlockKind` (`src/lib/schema/block-kind-descriptor.ts:177-186`) throws only when the kind is *un*registered; augmenting a registered built-in (`augmentBlockKind('paragraph', …)`) silently rewrites it globally. **P0 leak confirmed.**
- `checkStaleRaw` (`src/lib/invariants/node-shape.ts:73`) returns `null` unless `containerContract === 'strip'`; tests confirm grid and leaf are exempt (`src/lib/test/invariants/stale-raw.test.ts:124,130`). **The byte-level round-trip guard fires only on strip containers** — Fork A (§2.3) modeled as a non-strip container escapes it, and plugin leaf/grid/atomic kinds get no stale-raw guard even in dev. Confirmed; sharpens the Fork A cost.
- `createContainerBlock` actually returns `{ blockListProps, containerApi }` (`src/lib/editor-actions/plugin-container.ts:53-58`), not the `{ surfaceProps, blockComponentApi }` the report's Tier-2a sketch stated — the critique's catch is correct.

**Reported but not yet verified against code** (plausible, cheap to confirm when we act): the startup-once + dev-only nature of `checkOpenerRegistry` / `checkRegistryCompleteness` / `checkKeymapCoherence` (critique's central enforcement correction), and the `runCommand(id, arg?): boolean` dispatch signature.

---

## Synthesis report

**One-paragraph verdict.** Aragonite has already made the two hardest calls correctly: a _cohesive per-kind unit_ (opener + descriptor + component) rather than ProseMirror's three-surface split, and a real _contentDOM-analog_ (`createContainerBlock` + nested `BlockList`) that most competitors either lack (CM6/Obsidian) or fake with a parallel source of truth (Lexical/CM6 nested editors). The pre-freeze work is not architectural reinvention — it is (1) closing fail-loud registry leaks, (2) making the _editable-leaf_ path reachable through a factory instead of forcing plugins into `$lib` internals, and (3) settling one genuine fork — **how editable _chrome text_ (the details `<summary>`) relates to the CST** — because that fork decides whether the frozen contract even has a _slot_ for native-editable chrome, which is the literal trigger for this whole exercise.

### 1. Extension-point taxonomy — the convergent shape

Across ProseMirror, TipTap, Milkdown, Lexical, CM6, VS Code, and Obsidian, "what a plugin author expects to add" converges on **six orthogonal categories** (they differ in ergonomics, not content):

| #   | Category           | PM / TipTap / Milkdown                   | Lexical                           | CM6              | Obsidian                   | Aragonite today                                     |
| --- | ------------------ | ---------------------------------------- | --------------------------------- | ---------------- | -------------------------- | --------------------------------------------------- |
| 1   | Type / schema      | NodeSpec / `Node.create` / `$nodeSchema` | `ElementNode`/`DecoratorNode`     | (n/a)            | (n/a)                      | `BlockKindDescriptor` + `declarePluginKind` ✅      |
| 2   | Recognizer         | parseDOM / inputRules / `parseMarkdown`  | `ElementTransformer.regExp`       | Lezer grammar    | code-fence / postprocessor | `BlockOpener` ✅                                    |
| 3   | Serializer         | toDOM / `toMarkdown`                     | `.export()`                       | (text is truth)  | (text is truth)            | `rebuildRaw` ✅ (byte-lossless — stronger than all) |
| 4   | View               | NodeView                                 | `createDOM`/`decorate`            | WidgetType.toDOM | toDOM / component          | Svelte `BlockComponent` ✅ (no adapter tax)         |
| 5   | Commands + keymap  | Command + keymap                         | `createCommand`+`registerCommand` | keymap facet     | `addCommand`               | descriptor `keymap` ⚠️ (command mint dead)          |
| 6   | Local plugin state | StateField + PluginKey                   | `addStorage` / `Ctx`              | StateField       | `addStorage`               | `set/getPluginMetadata` ⚠️ (per-node only)          |

Two structural lessons, both already load-bearing for aragonite:

- **Cohesive unit beats fragmentation.** ProseMirror's three separate surfaces (schema-merge + plugin-array + nodeViews-map) is the anti-pattern — TipTap/Remirror exist to collapse it back into one declarative unit per kind. Aragonite is already on the good side. Do not trade it away.
- **Register-once, fail-loud, namespaced.** Every system that used silent last-writer-wins for its declarative layer (VS Code language associations, Milkdown's shared remark stack, Obsidian) grew a chronic collision tax. Aragonite's conflict-on-duplicate is better than VS Code's declarative layer — the defect is the registries that leak out of that discipline (§4).

**Verdict:** the taxonomy is complete and correctly shaped for categories 1–4; category 5 is inert; category 6 is thin. Nothing motivates adding new _contribution points_ pre-freeze (the VS Code caution against 35 unvalidated points applies). The gaps are _reachability and enforcement_, not missing categories. _(Critique dissent: two convergent categories ARE missing — inline marks/inline-nodes and first-class paste — see critique below.)_

### 2. Editable custom content — the centerpiece

**2.1 The three archetypes.** Every editor answers "custom content that is itself editable like native content" with one of three mechanisms; aragonite's answer is forced by CST-truth + byte-lossless round-trip:

- **contentDOM / NodeView** (ProseMirror/TipTap/Milkdown) — plugin owns outer chrome; editor owns an editable hole whose children are real nodes in the one authoritative tree. **ADOPT — already built.** `createContainerBlock`'s nested `BlockList` _is_ the contentDOM. The crown jewel.
- **DecoratorNode + nested editor** (Lexical/CM6) — editable interior is a separate EditorState serialized as an opaque blob. **REJECT for editable interiors** — a parallel source of truth that cannot round-trip byte-for-byte. The single most important thing NOT to copy.
- **Decorations / widgets** (CM6/Obsidian) — view-only overlays; "editing" reveals hidden source. **Presentational only** (dimmed markers, badges) — must not enter the CST.

**Conclusion:** aragonite has the _good_ mechanism natively, with Svelte erasing PM's hand-diffing `update()` boilerplate. The trigger is a _reachability_ gap plus **one unmodeled coordinate**, not an architecture gap.

**2.2 A three-tier editable-content contract (subordinate to CST-truth):**

- **Tier 1 — Editable container (HAVE).** `createContainerBlock`; round-trips via `containerContract:'strip'`. Keep; generalize its overrides (§4).
- **Tier 2a — Editable leaf (BUILD).** A block that is itself a text surface — a plugin analog of `TextEditableBlock`/`CodeBlock`, a CST node with `raw` sitting directly in a `BlockList`, so it inherits cross-block selection, sticky-column, IME, undo for free. Today unreachable (`createEditableSurface` needs ~20 internal deps + context keys). **Recommendation:** do NOT export `createEditableSurface` raw; mint a sibling factory `createEditableLeaf(deps)` that mediates the contexts internally and returns props + the `BlockComponent` surface, mirroring `createContainerBlock`. No new invariant surface — the leaf is a CST node.
- **Tier 3 — Atomic widget (ROADMAP 1.2).** Non-textual embed; `contentEditable=false`; CST owns only the raw line(s); edge-addressable. The DecoratorNode analog done safely (no nested editor). The inline-widget registry it builds on is currently unguarded (§4).

**2.3 The fork the owner must settle — editable _chrome text_ (the details `<summary>`).** Tiers 1–3 do NOT cover the trigger. The summary is metadata-backed editable text in the container's _chrome_, outside the `BlockList`; it is not a CST node, so it has **no path**, and selection is path-addressed. A factory alone cannot make it native. Two forks:

- **Fork A — model chrome-text as a CST sub-node.** Native parity (arrow into/out, shift-select, undo-batching) via contentDOM logic. **Cost:** container is no longer plain `'strip'`; `raw`/`rebuildRaw` span header + children; the opener splits the summary into its own node. _(Critique correction: parity is NOT free — there is zero precedent for editable header/chrome nodes; the hidden sub-fork (summary-as-BlockList-child vs summary-as-header-node) may need the same coordinate-addressing capability, Excluded-1.2, that Fork B was penalized for lacking; and a non-strip container escapes `checkStaleRaw`, trading away the byte-round-trip guarantee.)_
- **Fork B — keep metadata + a bounded editable-field surface.** `createEditableField` gives focus/caret/type/IME/blur-commit within the field via `updateBlockMetadata`, but the §4.2 scoped-out list — cross-block selection especially — becomes **permanent contract, not a temporary limitation.** Click-type-blur is the floor.

**Recommendation:** CST-is-truth leans toward **Fork A for anything claiming native parity** — Fork B cannot keep the "editable like a native block" promise. Fork B is the honest bounded floor and an acceptable pre-1.0 answer **only if the owner explicitly accepts click-type-blur as permanent and writes it into the frozen contract.** What is NOT acceptable is freezing while leaving this implicit — that ships a promise the seam can't honor and grows a `$lib`-reaching shadow ecosystem (the spike commit `ea63b95` is the early warning).

### 3. Flexibility-vs-invariants boundary — explicit MAY / MAY NOT

Mature systems draw the line the same way: **plugins get a separate state slot + veto/augment seams, but never a raw model-mutation handle.** ProseMirror denies the doc handle structurally (`state.tr → dispatch`); Lexical funnels through `getWritable()`; CM6 through `state.update`; Obsidian through the `Editor` facade. VS Code adds a process sandbox aragonite structurally cannot copy (in-process Svelte components touch the real DOM + `$state` proxy). **Aragonite's substitute is discipline + invariants + fail-loud registration, enforced by API _shape_ (make the violation unrepresentable) wherever a runtime guard can't fire on external plugin code.**

**A plugin MAY:** register a kind (once, fail-loud); declare `rebuildRaw` invoked by the commit primitive; build an editable container and get windowing/split/merge/paste + the `BlockComponent` surface free; relocate/restructure a snapshot-shared subtree (byte-rewriting-free moves are exempt from aliasing); store _primitive_ per-node metadata; commit metadata via `updateBlockMetadata`/`updateOwnMetadata`; contribute a `keymap` over built-in command ids; contribute click-only chrome via `AmbientInteractiveRange`; render/measure/serialize as an unknown kind and degrade safely.

**A plugin MAY NOT:** write `raw` directly or invent a container whose `strip(raw) ≠ serialize(children)` (byte-enforced by `checkStaleRaw` — _strip containers only_); treat its DOM as authoritative or mutate the tree from the view; write bytes through a node reference captured before the commit; pass reactive CST state by value across a boundary or read/write a reactive inline cache in render (_shape_, not guard — the lint does not scan plugin source); introduce a new `mergeRole`/`unwrapRole`/`containerContract` (closed enums); leak the local window loop index; silently override a built-in/other plugin kind. **[Currently leaks, §4]** override a built-in inline widget; mutate a built-in descriptor via `augmentBlockKind`.

**Sharpest under-specified boundary for authors:** the render-memo-completeness class — a component memoizing on a key that omits a live path/index/policy it baked into DOM reproduces the image-widget path-staleness corruption, and **nothing catches it** (doc-only, tests over built-ins only). And the guards that DO fire on plugin nodes (`checkStaleRaw`, `checkSnapshotIntegrity`) are **dev-only** — a plugin developed only against a prod build gets no signal. Ship the message: **develop plugins against a dev build.**

### 4. Gap analysis — ranked by pre-freeze severity

**P0 — fail-loud parity leaks (fix before freeze; cheap):**

1. `registerInlineWidgetKind` no dup-guard (`inline-widgets.ts:27`) — plugin silently clobbers built-in `image`/`rawHtml` process-globally. Add throw-on-duplicate.
2. `augmentBlockKind` can mutate built-in descriptors (throws only on *un*registered). Reject augmenting built-ins / gate to plugin-owned kinds.

**P1 — reachability gaps that force plugins into `$lib`:** 3. `registerCommand` dead for plugins (closed `CommandId` union) — aligns with Cycle-3 command mint, but the freeze must not lock the union against later minting. 4. No editable-leaf seam (Tier 2a) — `createEditableLeaf`. 5. `createContainerBlock` yields a blockquote clone only — hardcodes `createBlockquoteOverrides` (`plugin-container.ts:88`) + `reorderable:true` (:146), no unwrap/merge/paste override hooks, container-rebuilder helpers unexported.

**P2 — contract hygiene:** 6. `BlockComponent` not re-exported from `plugin.ts` (plugins import their core type from the consumer barrel). 7. Descriptor-completeness _is_ checked (`checkRegistryCompleteness`) but startup-once + dev-only (critique correction), so post-mount / HMR plugin registration escapes it. 8. No paste-surface registration in the barrel (`registerPasteSurface` internal).

**Do NOT build (YAGNI):** activation-events/lazy-loading, disposable runtime lifecycle, marketplace, 35-contribution-point breadth. Register-once-at-load is the correct scale-down.

### 5. Recommendations

**(a) Target architecture** — keep the cohesive per-kind unit; layer editable-content tiers behind **factories that mediate context, never raw deps**. One `aragonite/plugin` barrel: IDENTITY / DESCRIPTOR (+own-kind guard) / COMPONENT / RECOGNIZER / SERIALIZER (+exported `serializeChildren`) / COMMANDS (build Cycle 3, namespaced) / STATE; content tiers `createContainerBlock` (have) / `createEditableLeaf` (build) / `createEditableField`-or-Fork-A (decide) / portal widget (1.2); unknown-kind degrade (have). Bake in: factories hide `editor-keys.ts`; every plugin edit routes through the commit ceremony; namespace plugin ids/kinds (`publisher.kind`); re-export `BlockComponent`.

**(b) Prioritized pre-freeze seams:** (1) close the two P0 leaks; (2) re-export `BlockComponent`; (3) settle Fork A/B for chrome-text; (4) `createEditableLeaf`; (5) generalize `createContainerBlock` + export rebuilder helpers; (6) reserve the command-mint shape so the frozen `CommandId`/keymap-coherence admit namespaced plugin ids; (7) descriptor-completeness at registration (not startup-once); (8) defer Tier 3 to 1.2 but fix leak #1 now.

**(c) Cycle 2 `details` §4.2:** **Keep the isolated-surface plan exactly as written** — it is a disposable dogfood instrument whose durable output is the F7 fix + `updateOwnMetadata` + the findings ledger, built against an explicitly pre-freeze `createContainerBlock`. Building a general primitive inside Cycle 2 would violate its scope discipline. **But reframe the pre-freeze decision:** it is NOT "build the leaf primitive now vs defer" (the leaf doesn't answer the summary — summary is chrome-text, not a leaf); it is **Fork A vs B for chrome-text**, and Cycle 2's §4.2 findings are the _evidence that forces that decision before freeze_. Do not let the scoped-out items harden into permanent contract by default.

**(d) Keep vs change.** KEEP: the cohesive per-kind unit; `createContainerBlock`+`BlockList` contentDOM; byte-lossless `rebuildRaw`; register-once/fail-loud/global-defs vs per-instance-state; unknown-kind degrade; the separate `aragonite/plugin` barrel; mediation-by-shape. CHANGE (pre-freeze): the two registry leaks; add `createEditableLeaf`; generalize `createContainerBlock`; re-export `BlockComponent`; settle + document Fork A/B; ensure command/keymap types admit namespaced plugin ids.

### 6. Open questions / thin-evidence areas

1. **What freezes at 1.0 vs 1.2?** Sources are internally inconsistent (contract froze foundation at 0.8.3, lists inline-widget/component-portal as Excluded-1.2, but the milestone says "1.0 = freeze-at-release" and a note says `index.ts` doesn't re-export the plugin API until 1.2). Owner must clarify — P0 leak-fixes are urgent if the foundation freezes at 1.0.
2. **Off-window vertical-transparency vs lazy inline** — whether a never-mounted off-window plugin inline-bearing transparent kind can answer `isVerticallyTransparent` (the external inline WeakMap may be empty). Spike before shipping such a kind.
3. **`AmbientInteractiveRange` beyond checkbox** — `role` typed to `'checkbox'` only; ARIA surface + failure mode under-specified for callout badges / collapsible toggles.
4. **`commitMultiScope` publish-phase residual** — decide whether plugins may author multi-scope structural ops pre-freeze.
5. **Runtime unregister/toggle** — not implied by register-once; confirm it's genuinely out of 1.0.

---

## Adversarial critique (completeness critic)

### Missing prior art

- **remark-directive / micromark-extension-directive / mdast-util-directive** — the Markdown-native lossless-extension ecosystem whose generic `:::name` container/leaf/text directive grammar IS the callout `:::note` syntax. Single most relevant omission for the recognizer AND serializer categories; evaluate a _single generic directive opener_ vs per-kind openers (shrinks the priority-collision surface).
- **BlockNote** — the closest living peer (block editor on ProseMirror/TipTap). `createBlockSpec` with `content: "inline" | "none" | "table"` + `propSchema` maps ~1:1 onto Tier 1 / Tier 2a / Tier 3. The tiers were designed in a vacuum relative to a shipping analog that already made these cuts.
- **Slate.js** — `isVoid`/void nodes are the atomic-widget tier done in-tree (the report's own recommended safe path); `normalizeNode` is the direct analog of invariant-enforcement-at-commit.
- **Named veto/augment seams** — ProseMirror `filterTransaction` (veto) + `appendTransaction` (normalize on commit); CM6 `transactionFilter`/`changeFilter`/`transactionExtender`. The report asserts "veto/augment seam but no raw handle" without naming the mechanism, and never asks whether aragonite should expose a sanctioned normalize-on-commit hook.
- **Editor.js block-tool API** (`save`/`render`/`validate` + `pasteConfig`/`conversionConfig`) — first-class paste/conversion, exactly the category demoted to P2.
- **Quill/Parchment** blot registry (the cleanest `customElements` register-once analog; Embed blots = atomic widget); **CKEditor 5** schema (`schema.register({allowIn, isObject, isLimit})` + upcast/downcast) — a strong model-view-with-containment analog to CST↔DOM with closed enums.
- **TipTap node-schema specifics** (`content:'inline*'`, `atom:true`, `addInputRules`, `addPasteRules`, `parseHTML`/`renderHTML`) — map directly to the tiers/recognizer; not mined despite TipTap being surveyed.

### Missing / contradicted constraints

- **Falsifies "only two registries leak the fail-loud discipline."** The opener _priority_ space is guarded (`checkOpenerRegistry`, `invariants/registry.ts:85`) but that guard is (a) dev-only (`assertInvariant` tree-shakes in prod) and (b) startup-once (`didStartupCheck`, `install.ts:44-54`, runs after built-in registration), so it does not re-fire for plugin openers registered after startup. Equal-priority openers then resolve by module-load order (stable sort) — a silent round-trip hazard for a byte-lossless recognizer.
- **Three registry-wide guards are startup-once**, which mis-grounds P2 #7. `checkRegistryCompleteness`, `checkOpenerRegistry`, `checkKeymapCoherence` run once via `runStartupInvariantChecks`. `checkRegistryCompleteness` DOES validate descriptor-completeness — the real gap is startup-once + dev-only, so any plugin loaded after first editor mount (the normal side-effect-import order) or via HMR escapes all three.
- **Fork A does NOT get native parity "for free."** Table cells / list-item content are BODY children addressed by index-path inside a BlockList/grid; the summary is editable HEADER/chrome, for which there is ZERO precedent (blockquote `>`, list markers are non-editable ambient). Fork A's hidden sub-fork — summary-as-BlockList-child (semantically odd, special-cased split/serialize) vs summary-as-header-node (needs the SAME coordinate-addressing, Excluded-1.2, Fork B was penalized for) — is not free.
- **Fork A collides with the closed `containerContract` enum worse than stated.** `checkStaleRaw` (`node-shape.ts:72-73`) returns null for any container whose `containerContract !== 'strip'`. A header+children container fits the frozen enum only by declaring `'grid'` — opting OUT of the byte-level stale-raw enforcement that is the product thesis. The report frames Fork A's cost as "richer contract / more parser work" and misses that it trades away the automated round-trip guarantee.
- **The taxonomy hides two missing convergent categories:** no inline-node/mark extension (mentions, `$math$` — no seam; `registerInlineWidgetKind` surfaces only as a leak) and no first-class clipboard/paste (`registerPasteSurface` internal, demoted to P2). For a GFM editor both are top-tier author wants.
- **The command dry-run convention silently mutates a to-be-frozen signature.** Actual `runCommand(id, arg?): boolean` (`commands.ts:53-56`) has no `dispatch` param; adopting PM's `(ctx, dispatch?) => boolean` dry-run is a pre-freeze signature change, not a costless convention.

### Weak / unverified claims

- "Only two registries leak" — contradicted (opener priority dev-only + startup-once; three guards miss post-startup registration).
- Fork A "parity for free" — unverified and likely wrong for a header node that is not a BlockList child; this is the freeze-gating claim resting on an unchecked assumption.
- P2 #7 "nothing validates descriptor-completeness" — inaccurate; `checkRegistryCompleteness` does, but startup-once + dev-only.
- `checkStaleRaw` "fires on plugin-produced subtrees" — true only for strip containers; plugin leaf/grid/atomic get no byte-level guard even in dev.
- `createEditableLeaf` "mirroring createContainerBlock exactly" returning `{surfaceProps, blockComponentApi}` — actual return is `{blockListProps, containerApi}`; specified without re-reading.
- "Unknown-kind degrade, a differentiator over Lexical's register-all-or-crash" — Lexical's actual unknown-node behavior not verified; "crash" framing may overstate.

### Recommended follow-ups

1. **Decide the opener-ordering + late-registration policy before freeze** — promote `checkOpenerRegistry` to a register-time throw and/or re-run the three registry-wide checks on every plugin registration; spike two equal-priority plugin openers to demonstrate the load-order round-trip hazard; confirm whether prod plugins get any signal.
2. **Prototype Fork A end-to-end** (summary as a CST sub-node) to falsify/confirm "parity for free" before it gates the freeze — does a header sub-node reuse BlockList/contentDOM addressing, or need the Excluded-1.2 coordinate-addressing anyway (making A and B share the same hard dependency)?
3. **Study the closest peers as concrete references** — BlockNote `createBlockSpec`, Editor.js block-tool, Slate void + normalizeNode — mapped against `createEditableLeaf` / Tier-3 / a commit-normalization seam.
4. **Evaluate remark-directive's generic `:::name` grammar** as the recognizer/serializer template — does one generic directive opener shrink the priority-collision surface, and can its serialization be byte-lossless under `serialize(parse(src))===src`?
5. **Settle the veto/augment/normalize-on-commit question explicitly** — will plugins ever get a `filterTransaction`/`appendTransaction`-style commit hook, or is invariant enforcement permanently editor-owned?
6. **Write down the status of the two missing categories** (inline marks/nodes; bespoke paste) as 1.0 / 1.2 / out-of-contract before freezing a block-only surface.
7. **Run the `isVerticallyTransparent` off-window inline-cache spike** with a plugin inline-bearing transparent kind.

---

## Decisions taken (2026-07-01, owner)

1. **Freeze timing — at the public open-source release, not before.** The plugin-authoring APIs stay pre-freeze/unstable through the pre-release window. Validation before the freeze includes **internal integration with the limestone app (without open-sourcing)** to prove the surface in a real consumer, alongside the in-repo dogfood blocks. The freeze cuts only at the public 1.0 open-source release. → The tracked sources (`docs/design/plugin-contract.md`, `docs/roadmap.md`) currently contradict this (foundation-froze-at-0.8.3; "1.2 flips the switch"); reconciling them to this model is a **deliberate tracked-doc follow-up** (done together, not committed to `dev` unprompted).

2. **Chrome-text: Fork A (native parity), not Fork B.** Editable chrome (the `details` `<summary>`, callout titles, future plugin chrome) is to be a **first-class, path-addressable CST citizen** with the expressive parity of native blocks — explicitly including **cross-block selection extending into it.** The owner rejects the Fork-B ceiling (click-type-blur, no cross-select-in). This accepts pulling **selection coordinate-addressing** forward from its roadmapped 1.2 slot if the Fork-A spike confirms it is required. A timeboxed Fork-A spike settles feasibility + cost before the container contract freezes.

3. **P0 foundation hardening stands** — dup-guard `registerInlineWidgetKind`, own-kind-only `augmentBlockKind`, re-export `BlockComponent`, decide opener late-registration policy. Cheap; do before binding limestone to the surface.

4. **Research retained** for reference through plugin-system development (this doc).

## Fork-A spike outcome (verified 2026-07-01)

A timeboxed spike branch (not merged) built the callout as a reserved child-0 chrome leaf. **Verified:** `check` 0 errors, `lint` clean, callout unit suite green, the plugins e2e battery green (re-run), the diff touches no `src/lib` `selection`/`cursor`/`tree-operations` runtime (tripwire held), and the e2e asserts `focus.path===[1,0]` non-vacuously.

**Verdict: Fork A confirmed — native cross-select-into-chrome is FREE.** Modeling chrome as a reserved child-0 leaf inside the container's `BlockList` (Model a) makes it a char-offset prose leaf; cross-block select-in, caret, and undo all reach the deep path `[1,0]` with **zero** core-selection edits — none of the seven `kind === 'table'` gates fire.

**Contract-shaping findings (feed the frozen contract + `createEditableLeaf`):**

1. **New fourth cost — chrome-kind non-stickiness (not predicted by recon).** `updateNodeContent`/`splitNode` reparse `raw` + re-derive kind on every edit; a bare title has no recognizer → the first keystroke downgrades the chrome kind (`note-title`→`paragraph`). Orthogonal to `mergeRole`. **Fix precedent in-tree:** `tableCell` skips reparse (`updateNodeContent:252`); reserved chrome needs a descriptor flag (`reparseOnEdit:false`/`contextDependentKind:true`) honored by `updateNodeContent` AND `splitNode`/`reparseAsNode`. **Content-edit-core (`tree-operations`), NOT selection** — doesn't undermine "Gate 1 free," but is the single most important `$lib` input to `createEditableLeaf` + the freeze.
2. **`createEditableLeaf` shape clarified:** inside a container a leaf needs exactly ONE import (`TextEditableBlock`) — the container seam already supplies every context. Its real jobs: (i) expose a leaf component as registerable, (ii) the kind-stickiness flag, (iii) a keymap/command override (Enter "descend to body" needs a plugin-minted command — blocked by the closed `CommandId` union → ties to the command mint). NOT context threading.
3. **`containerContract:'grid'` is overloaded** — used only to escape `checkStaleRaw`; a frozen contract should offer a dedicated non-strip value (`'opaque'`) or a distinct stale-raw-exemption flag, not overload `'grid'` (which elsewhere implies cell coordinate-addressing).
4. **§4.2 reconciled:** `updateOwnMetadata` shrinks to genuinely-metadata fields (`details`' `open`); the title is edited as leaf `raw`. F7/`setRootEl` motivation removed for Model (a) (chrome inside the sole `.block-list`); still warranted for chrome-outside-list / `details` collapse.

**Not settled by this spike:** the tertiary clipboard byte-fix (charter prediction stands); the `details`-specific collapse × chrome × windowing interaction (callout has no collapse).
