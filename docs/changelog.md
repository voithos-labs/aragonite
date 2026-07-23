# Changelog

Editor version history (CST block editor). **Style (pre-v1):** one tight entry per minor version; patch versions are working notes that collapse into the parent minor at the next bump — per-bug narratives belong in `git log`.

### 0.9.33: inline priority ladder + footnotes

The inline recognizer gained a published priority ladder mirroring `OPENER_PRIORITIES`, and GFM
footnotes shipped on it as the first-party `aragonite/plugins/footnotes` plugin. The pre-freeze
probe's definition side (0.9.30) was rebuilt from an opaque leaf into an editable strip container,
and the reference side is newly built: first-class inline widgets on the prefix ladder, replacing
the probe's decoration-overlay approximation.

- **Inline precedence overrides shipped.** The scan stage now consults a per-trigger rung list with
  published built-in anchors (`INLINE_PRIORITIES`), so a plugin recognizer can claim syntax that
  begins on a reserved trigger by registering a prefix rung priced below the built-in, the inline
  mirror of an opener pricing below a built-in. `[` stays a reserved trigger (a bare registration
  throws), but a `[^`-prefix rung wins it only where `[^` matches, and an unterminated `[^` declines
  and falls back to the built-in link reading byte for byte. Rungs on one trigger dispatch by
  priority ascending, then longer-prefix-first, then lexicographic, independent of registration
  order. Graduated from the roadmap's 1.2 precedence-override item, build-validated by footnotes.
- **Footnote definitions are an editable strip container.** `[^label]: content` parses to a
  not-mergeable container in the listItem mold: the `[^label]: ` marker paints as a dimmed ambient
  prefix on the first child, the body is real child blocks, and the container rebuilds its raw from
  the marker plus four-space continuation indents so a post-edit rebuild canonicalizes exactly as
  listItem does. The container factory grew a `getAmbientPrefix` thunk to forward the marker.
- **Footnote references are first-class inline widgets.** `[^label]` recognizes through the new prefix
  rung and renders as a superscript whose number derives reactively from first-reference order: an
  earlier reference typed elsewhere renumbers a widget live though its own block is never edited and
  its source never changes. The literal bytes stay in the raw, so round-trip and GFM portability are
  untouched, and a caret-adjacent destructive key reveals the source rather than deleting the
  reference whole. Numbering is a pure function over the read-only document (`assignFootnoteNumbers`).
- **The corruption oracle tracks the new surface.** A `footnote-ops` simulation drives both tiers
  under the structural and convergence oracle stack: reference type / reveal / edit / delete, and
  definition formation, mid-body split (pinning that the split grows the container and never the
  root, the blockquote-override boundary), and not-mergeable exit. The plugin ships at the
  `./plugins/footnotes` subpath, showcased on `/` and documented in the consumer and plugin guides.

Ship gates: unit 4396→4442, e2e 1463, check 0/0, lint 0, perf 95, perf:check 24/24.

### 0.9.32: the elegance run

An owner-directed whole-repo elegance pass: simplification, dedup, dead-code removal,
and evidence-gated performance work, run as thirteen read-only discovery surveys over
every subsystem (library, tests, e2e, shell, perf), a triaged ledger (~110 accepted,
every rejection recorded with its reason), and twenty-odd reviewed fix batches. Net
effect: the same behavior on fewer, better-homed lines — and three real latent bugs
found because rules moved into seams.

- **Rules moved to choke points.** The clipboard copy/cut/paste ordering lives in one
  `createClipboardHandlers` seam (four surfaces supply only their genuine arms); the
  pointer-drag lifecycle (listener trio, rAF coalescing, autoscroll, teardown,
  pointerId filter) lives in one `createPointerDragSession`; the end-wall deletion
  atoms live in the range-delete ceremony; a shared `NodeScope` carries the container
  getter trio once; `BlockquoteBlock` rides the container seam its docstring claimed
  to mirror. `emptyParagraph`, `remapStrippedLines`, `mintWidgetShell`,
  `cellRowCol`/`intraTableRect`, `readBlockPath`, `blockAtPoint`, and the segment
  walk inside `widget-offset` each collapsed multi-site duplication into one home.
- **Three latent bugs surfaced by the consolidation, fixed red-first.** CodeBlock and
  non-reveal table cells prevented the native paste only after the first await —
  provably too late, masked in e2e by the CST-authoritative re-render; a second
  pointer could end another pointer's drag on three of four lifecycles (only table
  filtered `pointerId`); the task-checkbox strip left stale `ParsedLine` offsets on
  the public opener surface.
- **The superseded paste mechanism is gone** (`insertParsedBlocks`,
  `foldPasteReplacement`, −204 lines) and its G2.9 invariant was rewired
  depth→strategy onto the live path — whose `paste`-op side had been unguarded.
  List-overrides' hand-copied delete/replace fell through to the shared core, gaining
  the noop-discard, focus-offset, and backfill guards it had drifted away from.
- **Evidence-gated perf.** Three refactors rejected on measurement (the
  commit-preview parse-once, the autolink prune — observed linear, the emphasis
  linked-list port — quadratic but confined to the documented transient axis, now a
  ledger characterization); three pure-waste removals shipped with two-sided pins
  (the keydown island scan, the dead caret-carry walk, and render keys folding a
  compact LRD epoch instead of the ~MB signature string). Two perf watches closed
  no-action (BlockHost heal, parser laziness). `perf:check` 24/24 with p50s at or
  below baseline throughout.
- **The plugin surface grew two additive conveniences** (`surfaceProps` on the
  editable leaf — a consumer can no longer drop a handler; `getPresentationMode` on
  the container factory) plus `containerClosure` beside `simpleLeafClosure`, all
  guide-documented pre-freeze.
- **The suites got cheaper to extend without losing a test**: ~750 lines of copied
  unit-harness assembly became four helpers with the live-getter contract; 31 test
  files moved to mirror their sources; two monoliths split as proven pure partitions;
  the e2e helper families (cell drag, pageerror capture, sim oracles, search split)
  consolidated coverage-neutrally; a new lint pins the block-content selector so the
  9-site parity rot cannot regrow.

Final commit gate: unit 4346→4396, e2e 1449, check 0/0, lint green, perf:check 24/24.
Per-fix miss-analyses live in `git log`; the run's triage ledger (accepted, rejected
with reasons, measured, deferred with anchors) is the durable record of what was
deliberately NOT done.

### 0.9.31: five reports and a ledger burn-down

Five same-day user reports answered, then the known-issues ledger cut from 22 entries to 11
in one dispatched pass: every fix red-first, every substantive diff adversarially reviewed,
and each surviving entry re-verified to carry a named deferral anchor.

- **User reports.** Enter in a setext title no longer demotes the heading and strands the
  underline as a junk block; split keeps a structural suffix with its block via a generic
  content-range rule at the `splitNode` choke point. Focused whole-block blocks (thematic
  break, mermaid) and selected inline widgets copy and cut with Mod+C/Mod+X, landed once in
  the shared seams so every kind of each tier inherits the gesture. Fence lines hide whole in
  reading and preview (a CSS-reachable wrapper per fence line; the bare-newline Chromium caret
  workaround proved dormant when faithfully reconstructed and was retired into a guarded e2e
  pin). The details disclosure caret centers on its summary line (buttons don't inherit
  font-size, so its em geometry resolved against the UA default). `check` runs at 0 errors
  0 warnings (the deliberate-interaction a11y suppressions; role questions stay parked at 1.1).
- **Byte fidelity.** Three CRLF defects closed red-first: the trailing `\r` (trim at the
  source slice), the interior highlighter mangle (highlight an LF copy, positionally restore
  each original ending, count-mismatch dev-warn at the seam), and the all-blank reading
  collapse. The wider-than-header truncation left the ledger for `syntax-tree.md` as accepted
  GFM-mandated normalization.
- **Caret and clipboard parity.** The post-paste caret now honors the documented contract on
  all ten routes (three divergent gates fixed, the residue-skip rule single-sourced into one
  seam); range-delete survivors descend by focusability rather than merge-eligibility;
  cross-block type-replace re-derives the surviving leaf's kind; copy during an active reveal
  reads the live DOM instead of stale raw.
- **Cells reach prose parity.** Decoration islands render and inline widgets reveal inside
  table cells through the prose seam's own machinery, guarded by a cell commit wrapper that
  escapes pipes and strips newlines (the row-splitting corruption a naive wire-up ships).
- **Entities render.** `&copy;` shows © as an atomic inline widget, the first consumer of the
  `deleteGranularity: 'atomic'` policy, gated to visibly-rendering glyphs (lone combining
  marks stay literal-source spans). Pulled forward from the 1.2 sketch.
- **Reload convergence.** An unclosed fence auto-closes when Enter-exit authors a block below
  it, so save-then-reload keeps the authored structure; the simulation's parse-convergence
  oracle is now unconditional (the exemption mechanism deleted whole). The closed/unclosed
  exit-scope asymmetry it surfaced was then decided in-container: the closed exit mints its new
  paragraph inside the fence's own container scope too, unified with the auto-close and the
  whole-block Enter tier.
- **The suite grew teeth.** New simulation gestures for decoration islands, block decorations,
  IME composition (driven over CDP), and atomic entities; the `DocPath` brand adopted across
  every op-family path composer with completeness enumerated by the compiler; G4.8 gained the
  clipboard-chord family and the consumer guide documents the new chords; the links-autolink
  test monolith split six ways at exact case parity; and the long-fixme'd reveal-blur spec
  fell to a systematic bisect that found no battery carrier at all, only a stale test premise.

Final commit gate: unit 4257→4346, e2e 1391→1443 (every project including simulation),
check 0 errors 0 warnings, lint green. Per-fix miss-analyses live in `git log`.

### 0.9.30 — The audit-response pass: an outside review, answered

A third-party audit of 0.9.28 (filed at `13e88c44`, retired with this entry — git history
holds the full report) was answered finding by finding; every wave landed on the full
commit gate (unit 4204→4257, e2e 1391, check 0, lint green throughout).

- **The freeze no longer cuts on first-party evidence alone** — the audit's highest-stakes
  finding, answered structurally: an external-author gate (a developer who is not the owner,
  tarball + docs pack, friction log blocking) in both the roadmap's freeze cut and the plugin
  contract's freeze criterion, and the 1.3 gap detector pulled in front of the freeze as a
  build probe. The **footnotes probe** — built strictly against the public surface, walls
  logged as findings — shipped the definition kind losslessly, proved the reserved-trigger
  limit end to end (`[` is unclaimable; references degrade to a decoration overlay), and
  falsified the feared linkReferenceDefinition collision (the built-in declines `[^` labels).
  Routed: the inline prefix-recognizer tier is designed ahead in the contract (additive-later
  by the freeze criterion, build-now candidate), and the reserved trigger set is now in the
  plugin guide — the probe's one doc blocker.
- **The closure tax on simple leaves is repealed.** `simpleLeafClosure` on `aragonite/plugin`
  bakes the five structurally-fixed columns and requires the four the component determines —
  omitting one is a compile error; toc/mathBlock/memo migrated with modes unchanged;
  via-string guidance (name your own mechanism, never an internal watcher). Containers keep
  the full nine on purpose.
- **The property suite gained the oracle it was blind without.** A kind-differential property
  (commonmark.js reference; the three documented divergence classes allowlisted by input
  predicate, never a baseline lookup) fails the emphasis misclassification the byte/tiling
  properties provably pass — the audit's own falsification, replayed red-first. An opt-in
  fresh-seed lane (`PROPERTY_FRESH=1`, seed printed for reproduction) threads all 22
  `fc.assert` sites; fixed seeds stay the deterministic gate. Miss-analysis: no property
  oracle read node kinds — conservation held while classification broke.
- **The three flagged internals are structural now.** The cross-block table-delete ceremony
  deduped into three order-stable atoms with each case's load-bearing orderings explicit (the
  identity scan measured at ≤1 per gesture and its cost class documented — the audit's
  "several times" was overstated); the reveal/fold machine behind one `RevealState` and one
  canonical reset every exit funnels through (null-before-await pinned by a
  synchronous-observation test); the commit rollback behind one frame with one restore
  (splice-then-throw pin covering the redo-populated dimension). All mutation-verified in
  review.
- **ESLint installed** — the missing standard net: curated flat config (floating promises,
  misused promises, switch exhaustiveness, unused values; type-aware over all `.ts`), wired
  into `npm run lint`. 514 findings triaged: 28 real cleanups, 45 intentional patterns made
  explicit (`void`, `default:`), 441 noise-class configured off with reasons, 5 reasoned
  inline disables. Zero live bugs in product code; product `src/lib` was already `any`-free
  and `no-explicit-any` now stands guard as an error there. One adopted rewrite regressed
  the demo plugins page — `prefer-writable-derived` moved a parsing read from post-mount
  effect to first render, ahead of the page's async plugin installs, firing
  late-opener-registration across e2e-plugins — caught by the ship battery and reverted
  with the deferral's load-bearing timing now stated at the site. Miss-analysis: the battery
  had the failure all along; a piped gate command masked its exit and only the
  passed-count discrepancy exposed it — the never-pipe-a-gate rule, re-learned at the
  controller level.
- **Docs tell the honest version.** The README's lossless promise carries its edit-time
  asterisk beside the claim; editor.md's "adding a block type is boring" carries the
  variation-vs-novel-capability discriminator; the fifteen dangling architecture-concerns
  comment pointers are gone; the docs link gate covers the whole corpus (code spans stripped,
  footnote definitions excluded, empty allowlist) — Markdown links only; HTML `<img>` embeds
  stay outside its reach.
- **Readability, audited and codified** (owner-directed): the ~20 most complex files scored
  against a written top-down rubric — 16 GOOD / 6 ACCEPTABLE / 0 NEEDS-REORDER, the
  newspaper discipline held — six approved moves only (five honest-section dividers, one
  487-line state-orphan hoist, contiguous block-node types in `core/nodes.ts`); the
  newspaper-order standard and the composition-root rule are now `code-style.md` content.

### 0.9.29 — The freeze-surface liveness pass: live reads become thunks

Pre-1.0 roadmap item 1, plus gap fixes from the exploration audit that preceded it. The scar
this closes: a getter property and a value property are structurally identical to TypeScript,
so an external author could pass a snapshot where the contract means "re-read live," compile
clean, and hit the stale-capture class beyond every internal oracle. Every live read on the
frozen factory deps surfaces is now an explicit thunk — value-capture does not compile.

- **Deps thunks.** `ContainerBlockDeps` / `EditableLeafDeps` `node`/`index`/`path` getters
  become `getNode()`/`getIndex()`/`getPath()`, stating the rule the shape now carries: a
  function-valued field is a live read re-evaluated per use, a plain-valued field is static
  config. Type pins keep value-capture uncompilable; G4.1 accepts the thunk-reference form;
  every in-repo consumer converted (the consumer example's reader prop also swept
  `CstNode` → `NodeView`, closing its ledger entry). The audit half is recorded: chrome
  deps and the decoration provide context carry only static config and per-call values —
  nothing else to convert — and the item's planned timing-primitive lint turned out to
  predate it (G4.4, shipped `02b00c3b`).
- **Trailing-line-ending parity (G4.20) + the CRLF class fix.** The new lint pins the
  keystroke-commit append; its inventory surfaced twelve sibling sites reconstructing the
  ending as a bare `'\n'` — CRLF-lossy on code-block commands, cut, edge-policy deletes,
  and reveal-fold — all moved to `trailingLineEnding(raw)`, with a representative CRLF
  gesture pin.
- **Per-block opener context.** The parser mints a fresh `OpenContext` per block, retiring
  the comment-only retention hazard on the frozen opener surface — a stashing opener now
  holds a stable object, pinned by a retaining-opener test.
- **Core gap fixes.** The inline-content cache splits into per-signature-space slots
  (interleaved resolver-less and resolver-ful callers no longer evict each other on every
  call — identity-pinned); the CommonMark §6.6 tag grammar is single-sourced into the
  type-7 HTML-block opener (the "must stay in sync" comment retired — divergence is
  unrepresentable); the perf docs re-match the gate they describe (nine fixture shapes, the
  1MB+10MB gated rows, the additive tolerance and runner scale, the counters.test.ts
  ceiling attribution); the plugin contract's registry enumeration is complete again.

### 0.9.28 — The forge-review hardening pass: a repo-wide audit, fixed to green

An owner-directed four-pass audit (bugs / design+docs / test quality / organization) over the
entire repo — every Critical/Important finding reproduced or revert-probed before fixing,
every fix landed test-first with its red quoted. The byte round-trip core survived a
dedicated hunt untouched; the fixes concentrate in structure-correctness, routing, and the
gates themselves. The full battery, conformance slice, and perf ceilings are green with zero
expected failures at the cut.

- **Corruption fixes.** Indented-fence rendering corrupted bytes on load-then-type (the
  audit's one critical); a typed `|` in a table cell shifted or silently dropped cell content
  on reload; a stale render key let undo be silently re-reverted after a kind flip;
  cross-block inline paste left a stale kind over new bytes; clipboard during a widget
  reveal spliced at stale offsets and muted subsequent typing; CRLF-authored documents
  normalized on details/mermaid/directive rebuilds and on the first keystroke.
- **GFM conformance + parser robustness.** List items absorb lazy continuation lines (and
  list-exit now mints the blank-line separator its output needs on reload); `www.` autolinks
  gain their scheme; link-reference definitions reject trailing garbage and yield to block
  openers; indented code interrupts non-paragraph predecessors; entity-shaped autolink tails
  are excluded; container nesting depth caps at 512 with byte-preserving degradation (was a
  stack-overflow crash reachable from ~2KB of input); the backtick and directive-closer
  scans join their siblings' bounds, retiring two super-linear shapes.
- **Keybinding routing.** Malformed chords fail loudly at every ingestion path (a `Ctrl+W`
  typo no longer silently steals every `w`); the container bubble honors consumer global
  disables; document-level chords gate on instance containment — multi-editor pages route to
  exactly one editor, and a sole editor yields Ctrl+F to a foreign text input.
- **Selection.** Same-path cross-block state is unmintable (the invisible-selection class);
  backward-selection entry captures the anchor, not the range start; full-column delete
  tolerates windowed-out rows; `getSelection()` reports real within-block range offsets;
  table Shift+Arrow extension walks rows and exits the table.
- **The test platform got its real oracles.** A live-tree convergence check
  (`parse(serialize(live))` structurally equals the live tree) replaces the tautological
  post-mutation round-trip assert everywhere it stood — the published conformance kits, the
  e2e bridge, and every simulation checkpoint; both kits assert rebuild identity against the
  parse; commit-family negative-controls pin that the invariant belts are actually buckled;
  the simulation gains cross-block-destructive and merge gesture families plus session
  undo-unwind and selection-validity oracles; the undo property types markdown at arbitrary
  offsets and replays redo; keyboard-extend gains its mirror-direction and dispatch-layer
  coverage; the editable-leaf tier intercepts clipboard like every other editable surface.
- **Honest gates.** `--passWithNoTests` dropped from all 21 unit scripts; the CI perf job
  measures the prod build it always claimed to; the consumer example exercises all eight
  published subpaths; the docs-pack link closure and verify-pack harden (the required list
  now derives from the exports map); four new parity lints (G4.16–G4.19).
- **Organization.** The scan/directive/conformance test suites fold under their source
  mirrors; decoration and search state move home to their feature directories; the built-in
  descriptor registrations split from the descriptor contract.
- **VR-1 resolved by exoneration.** The long-red anchor spec was measuring in the wrong
  frame — the demo harness header's re-wrap moved the whole editor 72px and the spec read
  viewport-absolute coordinates. Instrumentation proved the windowing correction holds the
  anchor to 0.22px; the spec now measures editor-relative, and a revert-check confirms it
  still catches a genuinely broken correction.
- **Ledger.** Ten `docs/issues.md` entries closed; every surviving entry re-verified this
  audit with its rationale, fix design, or falsification history recorded.

### 0.9.27 — The architecture-concern pass: five flagged designs, five recorded resolutions

A post-0.9.26 architecture review flagged the five designs most likely to be regretted after
the freeze; the owner's build-up-front posture demanded every one be attempted before the
limestone integration binds to them. All five resolved — two fixed as types, one built, one
consolidated, one exonerated by measurement (this entry is the durable record; the working
doc it summarizes was retired once resolved):

- **`SelectionPoint` is a discriminated union** (`CharSelectionPoint | CellSelectionPoint` on
  the `cellCoordinate` flag). `offset` keeps its name on both variants — near-source-compatible
  for every consumer — while cell mints carry `satisfies`-enforced construction teeth, the undo
  copy path preserves the variant, and the intra-table context-established convention is
  documented on the type. The dual-space wart no longer freezes loose at 1.0.
- **`CstNode` is a discriminated union** — per-built-in-kind arms with typed metadata behind
  `isBuiltinBlockNode`, plus the open branded-plugin arm. The one production in-place `kind`
  write (the re-parse transfer) proved vestigial and now mints-and-replaces on kind change,
  while same-kind edits keep in-place field writes — node identity is load-bearing (the
  block-list registry, height caches, and inline accessor key WeakMaps by node), now pinned by
  an identity test. Honest boundary: the branded plugin arm blocks full-union narrowing, so the
  ~90 `metadataOf` sites keep the single sanctioned funnel; the union's wins are construction
  correctness, native narrowing in the built-in sub-union, and a discriminable `NodeView`.
- **Registry reads resolve through per-instance views over global definitions.** The default
  view aliases the global reads — behavior-preserving by construction — with a harness-proven
  enablement knob (editor A renders a plugin kind raw-editable while B renders it live, one
  process); `parse` gains an additive `{ grammar }` option threaded through the content-commit
  reparse. The **SSR registrar-poison class is structurally fixed**: under a dev server a
  duplicate registration replaces with a note instead of throwing, so a re-evaluated registrar
  survives — prod and test keep the frozen register-once throw. Honest boundaries recorded for
  limestone: the initial parse stays global, inline enablement waits on layering, the
  enablement knob's public shape firms with the first real consumer.
- **The context surface consolidated**: 36 keys → three named facets (services, policies,
  document) plus the eight load-bearing per-key survivors — the container override triple,
  history (G1.4), and the scope-provided channels. Byte-identical; mounting a block component
  in a test is now one `editorMountContext()` call instead of thirteen stubs. The aligned
  `BlockComponent` probe-facet grouping is recorded as freeze-cut input, deliberately unshipped.
- **Container-raw redundancy: exonerated by falsification.** The new combined depth-x-size
  benchmark (the axis no prior fixture reached) measures realistic deep-nesting typing at
  ~1-2 ms/keystroke of ancestry rebuild — floor class, two orders below the pathological
  class — with the superlinear tail confined to adversarial shapes. The most guard-hungry
  design in the repo keeps its guards and gains its evidence.
- **Perf e2e baseline re-blessed (2026-07-16 run).** First re-measure after the 0.9.26/0.9.27
  milestones, which the 2026-06 baseline predated: many-small-blocks 10MB load 22.1s → 4.5s,
  reference-heavy 10MB load 2.5s → 1.1s, single-giant-paragraph 10MB keystroke 1.8s → 1.2s;
  the viewport-bounded keystroke band reads 2.5-4.4ms across every shape and size. Bench time
  rows keep their 2026-06-20 reference values.

### 0.9.26 — Presentation modes: the full live-preview ladder

Always-visible styled source stays the editing substrate and the default — these modes make it
a choice, not a ceiling. The reason this shipped pre-1.0 is the contract, not the feature: a
plugin can now learn the presentation mode at every tier, so nothing authored against 1.0
strands when a consumer flips to preview.

- **The mode contract.** `PresentationMode = 'source' | 'reading' | 'preview-block' |
'preview-inline'`, a live `presentationMode` prop (the `theme` shape) reflected as
  `data-presentation` on the root, and one effective-mode resolution feeding four doors: the
  root attribute, a block-facing context getter (riding the render key), a plugin-facing
  `EditorContext.presentationMode` getter + `presentationModeChange` event, and getter reads on
  the editable-leaf and inline-widget tiers. Per-tier reactivity is documented honestly — the
  block-component DOM read is point-in-time; live reaction subscribes to the event.
- **Reading mode** — markers hidden, widgets rendered, read-only. Hiding is CSS-first (the
  raw-aware walk counts lengths, not layout, so offsets survive by construction; render-path
  omission is forbidden). Read-only is structural: `contenteditable=false` kills the whole
  browser-edit-path class, with paste/commands/drag/islands/checkbox gates at their dispatcher
  seams. Selection, copy, and mouse/scroll navigation stay; lists keep rendered bullets and
  visible ordered numbers. Fully inert v1 — interactive reading (live checkboxes, details
  disclosure) is a ledgered product question.
- **Block-granular preview** — unfocused blocks hide their syntax (broad-hide + focused-reveal
  by DOM containment; the focused leaf renders full source) at zero hot-path cost: focus flips
  are CSS attribute changes, never inline-DOM rebuilds, and the caret's DOM anchor survives the
  reveal so click-landing needs no correction.
- **Inline-granular preview** — the target. Within the focused block, construct markers
  (emphasis, strong, strikethrough, inline code, links, image syntax) hide until the caret
  enters the construct's range; entry reveals the full nesting chain, leaving folds it. The
  trigger is model-layer (raw offset against the inline tree, O(nodes-at-caret),
  composition-gated) with a synchronous keydown backstop — the e2e found rapid arrows outrunning
  the async reveal and skipping hidden bytes; the backstop reveals before the step lands,
  pinned by char-by-char walks asserting every offset.
- **Caret affinity dissolved under raw-as-truth.** The roadmap anticipated stored-marks-style
  machinery; verify-first found none is needed — the caret is a raw offset, revealed source
  makes boundaries visible, and typing lands where the visible caret sits (right-prefer decides
  which construct reveals at a shared boundary). Pinned across the adversarial boundary cases
  (edge typing, adjacent constructs, fold-then-type, backspace degrade); recorded as a design
  finding rather than built as machinery.
- **The opening move paid off first**: the three caret-edge/destructive-key seams consolidated
  into one declarative edge-policy dispatch (byte-identical, full-battery-proven) with the
  trimmed `deleteGranularity`/`onEdge` policy fields re-added; G4.12 now pins the funnel, so the
  reveal semantics joined ONE dispatch instead of minting a fourth seam.
- **Guardrails caught real bugs mid-milestone**: an existing reading-inertness e2e caught a
  four-site parity miss in the mode-gate threading (fixed; the residual is ledgered), and the
  0.9.25 instruments carried into the new machinery. The simulation gained a mid-session
  mode-flip gesture with a byte-stability oracle; a11y scans cover all three new modes under
  the same ratchet; the showcase and harness routes toggle every mode.

### 0.9.25 — Inline observability: the flight recorder before the field reports

The inline layer's per-keystroke rebuilds make every inline state transient — cursor
capture/restore, reveal open/fold, widget-pool adopt/sweep, IME composition, island
application — so a field report used to arrive after the state that produced it was gone.
This milestone makes the layer observable, asserts its state machines, and pins the
composition contract directly. Built now, deliberately, before the two events that multiply
the exposure: presentation modes (which multiply the inline state machines) and the limestone
integration (the first external field-report source).

- **The interaction trace.** A ring buffer of inline-layer transitions
  (`debug/interaction-trace.ts`): rebuild + which render-key segment changed, cursor
  capture/restore/pending, reveal open/fold + reason, pool adopt/build/sweep counts,
  composition start/end, island applications, sticky capture/reset. Ships in production
  **default-off behind one boolean per site** — the perf-instruments discipline without the
  DEV strip — so a real app can arm it; disabled cost is one boolean check (perf-suite-pinned,
  byte-identical behavior). Trace entries carry primitives only — never document text.
- **Two doors.** The debug panel gains an Inline trace section riding Copy-all; consumers get
  `getDiagnostics()` on the editor instance — trace enable/snapshot plus
  `serializeDiagnostics()`, the attachable fenced-markdown field report (document source
  excluded by default; `includeSource: true` is the consumer's explicit call). A field report
  becomes: reproduce, copy, paste. The trace is process-global (two editors interleave) —
  recorded, revisited with the reveal mount-waiter keying at the freeze cut.
- **Transition assertions (G1.25–G1.27).** The pool bracket becomes explicit and asserted
  (acquire outside a beginPass/sweep bracket, unbalanced brackets), reveal transitions assert
  their illegal interleavings (fold during the settle window; the kernel precondition speaks
  on the invariant channel), and the composition window asserts end-without-start — all on
  the `invariant:` channel every e2e spec and the simulation already police. The
  pending-cursor machine ships NO assert, by proof: the render effect clears it
  unconditionally in both arms — the leak state is unrepresentable. Left-silent paths are
  recorded with evidence; a defensive bail on a legal transient stays silent by rule. The
  ledgered battery-order reveal flake now has a diagnosis channel: a reproduction names its
  illegal interleaving instead of surfacing three layers away as a caret mystery.
- **The IME composition harness** — the ledgered gap closes. Handler-level unit contract
  (real editable-surface handlers, synthetic composition sequences, faked DOM readback): no
  CST sync mid-composition, one commit at end, one undo entry, CodeBlock's `insertLineBreak`
  gate both sides. Real-browser CDP sequence (`Input.imeSetComposition`, listener-verified
  compositionstart/end — not an insertText degenerate) over paragraph, code block, and table
  cell, undo included, deterministic under repeat. Safari's duplicate-compositionend quirk is
  ledgered with a relax path; the composition sim gesture is ledgered pending.

### 0.9.24 — Enforcement hardening: the load-bearing contracts climb to types

The 2026-07 audit's two dominant bug classes — sibling-path parity and offset arithmetic
outside the shared walk — were held by dev guards, prose, and review. This milestone climbs
them to the compiler while the climb is cheap, before external code binds: a new consumer now
inherits the contracts from types, not from `culture.md`.

- **Branded coordinate spaces (G3.7).** Raw offset, ambient-inclusive DOM-text offset,
  editor-relative X, viewport X, cell index, and doc-absolute path are distinct branded types
  (`cursor/coordinate-spaces.ts`), minted only by their single-home modules; inter-space
  conversion is a named function with one home per direction; public doors keep `number` and
  brand once at the boundary, policed by a mint lint (G4.15). The pass corrected the space
  model itself: the widget-offset walk is marker-_inclusive_ — it speaks DOM-text offsets, and
  raw offsets mint at the ambient seam; the design doc had it backwards, and the brands now
  make the true model unrepresentable to violate. `SelectionPoint`'s dual-space `offset` reads
  through space-split accessors; the selection overlay's endpoint decode branches honestly by
  space. `DocPath` is deliberately narrow (the scope factories + the G1.16 entry are branded;
  op-family composers stay `number[]` with the runtime guard as the belt — ledgered).
- **The closure matrix is a required type and an executable battery.** Registration carries a
  `closure` block answering all nine cross-cutting systems (implemented / inherit-default /
  not-supported) — a blank cell is a compile error, G1.24 cross-checks cells against the
  descriptor, and a `conformanceFixture` rides the declaration. The `aragonite/testing` kit
  generalized: registering a kind ENROLLS it — headless cells (round-trip, merge, clipboard,
  undo) execute at the unit gate, a profile custom check is refused on a cell not declared
  `implemented` (so a bare mode revert bites), and the bundled lockstep anchors on the plugins
  directory listing. A browser sweep executes the three mounted-DOM columns (focus walk,
  selection paint, search paint) per registered kind from the live registry. The audit-then-
  execute sequence earned its keep immediately: the declared-vs-real audit caught a false
  table clipboard cell (a real rectangular sub-table copy path had been declared
  inherit-default), the sweep ledgered two render-primary search-paint gaps (mathBlock, toc)
  as two-sided ratchets, and the sweep's exact-source settle fix exposed that the tableRow
  rows had been silently sweeping the previous kind's document (the harness's same-value
  `setSource` is a `$state` no-op — each load now varies leading trivia).
- **Readonly-by-layer CST views (G3.8).** `NodeView`/`DocumentView` are bytes-scoped
  deep-readonly views — exactly G1.9 as a type: serialized bytes readonly, the
  `childIds`/`ownerEpoch` bookkeeping writable. Components, the decorations engine, and the
  entire plugin surface (`EditorContext.document`, `DecorationSource.provide`,
  `BlockComponentProps`, descriptor read hooks) read through views; constructors and writers
  (`parse`, `tryOpen`, `rebuildRaw`, the factories) keep the mutable type; the only
  view→mutable door is the unshare seam plus the commit ceremony, policed by a door lint
  (G4.13) and an annotation-parity lint (G4.14). Every in-repo consumer compiled unchanged —
  the byte-write discipline was already clean; it is now a compile-time guarantee, with the
  DEV integrity oracle kept as the runtime belt.
- **Sibling-path parity lints (G4.10–G4.12).** Source-scan guards where funnels can't exist
  yet: plugin pack surface (every `src/lib/plugins/<name>` has exports-map + verify-pack
  entries), paste-transform two-site parity (a clipboard→parse route born without the pipeline
  fails at birth), and caret-edge destructive-key seam parity (no unguarded fourth seam;
  consolidation stays presentation-modes work).

### 0.9.23 — Demo groundwork: bundled plugins ship as package subpaths; `/` is the showcase

The structural half of demo polish, pulled forward so everything after it lands into final
structure: the limestone integration's developer meets the repo through the demo and the
plugin folders, and both now read as product, not dev artifacts.

- **First-party plugin packaging.** The bundled tier — admonitions, details, latex, mermaid,
  toc, highlight-occurrences — moves into the package at `src/lib/plugins/<name>/`, shipped as
  `aragonite/plugins/<name>` subpath exports (one version, one tarball, exports-map
  encapsulation). Dev fixtures (callout, memo, block-badge, fold, doc-stats, ghost-text,
  sim-mark) stay harness-side; the tier split is recorded in the packaging README.
- **Engines stay out of consumer bundles.** latex and mermaid split into engine-free cores and
  `/renderer` adapter subpaths: `aragonite/plugins/latex/renderer` is katex-backed and carries
  the one sanctioned CSS side effect (listed in `sideEffects`); `aragonite/plugins/mermaid/renderer`
  dynamic-imports mermaid. `latexPlugin({ renderer })` requires its renderer (math has no honest
  engine-free fallback); `mermaidPlugin()` stays legal and renders the fenced source statically.
  katex and mermaid become optional peerDependencies. Verified in built `dist`: engine
  references exist only in the adapters.
- **Bundled plugins are external-shaped, by guard.** Everything under `src/lib/plugins/`
  imports only the public authoring barrel — enforced by a new import-boundary source-scan
  lint with a per-adapter engine allowance. `getContentRange` joins the plugin barrel (toc is
  its consumer); the css-ownership lint covers both plugin roots.
- **The showcase route.** `/` mounts the editor with all six bundled plugins over a document
  covering every built-in block kind — the basic shell; the pitch content stays a later
  milestone. `/test/*` is uniformly machine-facing: the `?plugins=1` toggle and its badge
  retire, and `/test/editor` always renders the plugin-free default the batteries depend on. A
  showcase smoke spec (DOM-only, no test bridge) pins that every bundled plugin renders.
- **The copy-source sync retires.** `examples/consumer` installs bundled plugins from the
  tarball subpaths; the sync manifest shrinks to callout, which stays as the external
  _authoring_ validator. The consumer smoke now exercises the exact import shape limestone
  will use.
- **Tests move with their plugins** — bundled-plugin unit suites mirror the new source tree at
  `test/plugins/<name>/`; fixture suites stay flat; e2e specs route-repointed with zero
  behavioral edits. One new seam guard: the math injection seam pins that inline and display
  rendering thread their own `display` flag (the memo keys on it — cross-serving would swap
  block and inline HTML silently).

### 0.9.22 — Decorations + the public rect API: the extension surface completes

Decorations — view-only annotations over content a plugin does not own — were the one plugin
class the platform could not express, and the **public rect API** they bottleneck on had no
consumer door either. Both ship here, and **search migrates onto the decoration engine as its
first client** — proving the surface against a built-in before any plugin binds it. This closes
the last extension-surface gap; what remains before the freeze is validation depth.

- **The engine.** A decoration source is a pure `doc → Decoration[]`, memoized — no state API,
  nothing to map forward (positions are `(path, offset)` into a CST re-derived every edit). One
  edit epoch splits the two invalidation reasons: `notifyEdit` bumps the epoch and re-runs every
  source (the document changed), while a source handle's `invalidate()` re-runs just that source
  without the bump (its own state changed) — so a memoized source distinguishes "rescan" from
  "cheap remap". Each source runs contained: a throw keeps its prior decorations and surfaces as
  an attributed error, never blanking the view. **G1.23** forbids a source running inside the
  commit ceremony — it would read a half-published tree — so the re-run defers a tick past the
  edit event.
- **Four types, tiered paint.** `mark` (a positioned overlay per visual line, carrying the
  source's class), `widget` and `replace` **islands** (in-flow, applied in the prose render
  path), and `block` (whole-block). A mark whose range crosses dimmed markers, soft wraps, or
  ambient spans splits into one rect per fragment through the partial-rect measurement — the same
  geometry the rect API exposes.
- **Island editing semantics.** An in-flow widget or replace island defines caret and delete
  behavior at its boundaries (the atomic-boundary pin); an island that targets a non-prose block
  dev-warns at the source seam instead of silently rendering nothing.
- **The public rect facet, on both doors.** Consumer-side `editor.getRects()` and plugin-side
  `editor.rects` (from the `onEditor` context) return viewport-space geometry: a block's box, an
  inline range's rects, and the partial-rect split — the geometry a suggest popup or a selection
  toolbar needs, previously locked inside the cursor layer.
- **Search as client #1.** The find bar now rides an `editor:search` decoration source instead
  of the bespoke `MatchOverlay`, which is retired; the per-ancestor match-bucket read and the
  other memo behaviors it depended on are pinned as regression guards on the shared engine path.
- **The childless-opaque paint gap, closed.** A childless opaque container (mermaid) scanned no
  decorations and painted none — its endpoint box was invisible to the partial-rect walk; both
  the scan and the paint now include it, so a decoration over such a block lands.
- **Consumers, one per validated surface.** Dogfood sources for every type — highlight-occurrences
  (mark), block-badge (block), fold (island) — plus the selection-toolbar **consumer recipe**
  built through the public doors only, and the standing simulation source now asserted live. Each
  pins a type or a door end to end.
- **Guardrails.** An adversarial round-trip **property** proves a decoration never changes a byte
  of the source (reaching snap-outward ranges and ambient classes); **G1.23** and the **perf
  ceilings** hold the zero-keystroke-cost default — no source registered means no per-edit work —
  and cap the per-edit source cost.
- **Barrel + ledger.** The `Decoration` union, `DecorationSource` / `DecorationSourceHandle` /
  `DecorationRegistry`, and `EditorRects` join the public barrel and the plugin subpath. The honest
  remainders — islands inside table cells, single-block selection ranges, same-cell match dedupe,
  and simulation gestures for decorations — are ledgered in `docs/issues.md`.

**Posture shift, recorded as doctrine:** interfaces ship at industry breadth pre-freeze;
validation is added test consumers, never trimmed scope. A surface without an in-repo consumer
gets one written for it — a dogfood is validation, not a gatekeeper — and the surface is never
narrowed to what today's consumers happen to exercise.

### 0.9.21 — The plugin context spine: per-instance editor handle

`setup()` took no arguments and ran once per process, so a plugin could reach no editor: no
derived state, no edit reaction, no per-instance config. The context spine closes that class —
the one remaining extension-surface gap besides decorations (see `docs/roadmap.md`) — and two
dogfoods validate it end to end.

- **`setup(ctx)` + `onEditor`.** `setup` now receives a `PluginSetupContext`; `ctx.onEditor(cb)`
  registers a per-`<Editor>` callback that receives an **`EditorContext`** — `editorId` (stable
  per mount), a live `document` getter, a subscribe-only `events` view (`Pick<EditorEvents, 'on'>`
  — no plugin-visible `emit` to freeze), and typed `options`. The callback may return a disposer,
  run at unmount. Registration is synchronous-only (a leaked context throws), and `definePlugin`
  gained an `<Options>` generic so `editor.options` reads typed with no cast. Derived state is now
  a plugin-owned `Map` keyed on `editorId`, not a platform field — the state-API question is
  answered by making one unnecessary.
- **Per-instance options.** The `plugins` prop accepts a bare unit or `{ plugin, options }`
  (`EditorPluginEntry`), so two editors sharing one process-global registration can still run
  different options — the split-pane case. Same-name/different-identity stays first-wins with a
  dev-warn. The factory-closure pattern (per-instance config smuggled through the plugin factory's
  argument) is now an **anti-pattern** for anything two editors would vary; a factory argument
  stays correct only for a process-global dependency like a render engine.
- **`registerGlobalCommand`.** Mints a process-wide command whose handler receives the dispatching
  instance's `EditorContext` — the _same_ object `onEditor` hands out, never a second context — so
  an editor-scope action (open a panel, insert the date) fires regardless of focus. An optional
  chord binds in the **plugin-global tier**, which resolves last in precedence; built-in chords and
  the search chords (`Mod+F` / `Mod+H`) are unstealable and a collision throws before the mint. A
  handler throw is contained as an `error` of origin `command`, attributed to the owning plugin.
- **`BlockCommandContext.editor`.** A block command now reads the same `EditorContext` for
  document/events/options. The field is the pinned shape: document mutation arrives later as
  _further fields here_, never a second context object — the growth-as-fields decision the roadmap
  flagged as the one genuine breaking risk.
- **`BlockComponentProps.document`.** Every block component receives the read-only root document at
  any nesting depth, so a table-of-contents block can see the headings above it. The `toc` dogfood
  reads it at a nested depth — the validator that pins BlockHost's delivery on both branches.
- **`estimateHeight` descriptor field.** An optional O(1) per-kind height estimate the oracle
  consults after the collapse probe, before the prose char-wrap default — so a Mermaid diagram is
  estimated at its skeleton height instead of ~40px and scroll is right before it mounts. The
  measured cache still supersedes; a collapsed container still estimates at one chrome row.
- **Two dogfoods + a simulation detour.** `doc-stats` (onEditor + a plugin-owned stats map + a
  global command + per-instance options) is the context-spine validator; `toc` is the document-prop
  validator; the simulation gained a global-command detour, so the corruption oracle now watches the
  new dispatch path.

### 0.9.20 — Plugin-platform hardening: the evaluation program, pulled forward

A full platform evaluation (two audits: API/contract; every reference plugin read as a
consumer), then everything it found shipped pre-freeze in one owner-directed program — so the
limestone integration and the second clean-room run validate the improved surface, and no
early adopter hits a wall we already knew about.

- **Contract ambiguities closed (P0).** `augmentBlockKind` gains an ownership gate — a plugin
  can no longer silently overwrite a sibling plugin's kind descriptor (red-first). Minted
  block commands now dispatch on the plugin editable-leaf tier through the same
  `runMintedCommand` seam as the container-bubble path (previously: silent dead-key). A
  `'command'` error origin with containment at both dispatch choke points — a throwing plugin
  handler becomes an attributed error event, never an uncaught window error. New
  **`aragonite/testing`** subpath: one `resetPluginPlatformForTests()` aggregate (env-guarded,
  barrel-tested), so third-party authors get the isolation the in-repo dogfood tests always
  had; plugin-guide gains the testing recipe.
- **The command→component channel** (the #1 recorded authoring wall): factory-level
  `commandHooks` getter threads plugin UI hooks into `BlockCommandContext.hooks` on both
  tiers — no node-keyed map, no lifecycle cleanup; the dispatch context is built inside the
  owning component's factory. Mermaid's hand-rolled `uiHooks` bridge deleted (net negative
  LOC).
- **Renderer memo primitive**: `createBoundedMemo` (one signature unifying sync clone-on-read
  and async promise/rejection caching) on the barrel; latex + mermaid migrated off their two
  divergent local LRUs; the guide consolidates the renderer recipe (factory-option DI, error
  fallback, engine-CSS ownership).
- **Ceremony floor cut**: `createDirectiveRebuild`, `chromeChild`, `definePluginBlock` —
  the copied rebuild/title-child/registration ceremony deleted from every dogfood. The
  component re-export block is deliberately NOT collapsed (a capturing helper would
  reintroduce the getter-snapshot corruption class); promoted documented→guarded via a
  `satisfies ContainerBlockComponent` completeness check in every container dogfood, with the
  platform-collapse idea ledgered for 1.2. Centralizing the rebuild also closed a CRLF gap:
  title-mode directive containers had no line-ending-fidelity coverage.
- **Folklore became contract.** `OPENER_PRIORITIES` exported and single-sourced (built-ins
  register FROM the constant — drift is a compile error) with the guide's ladder table; the
  theme-token manifest published (both-themes existence guard, the dead
  `--color-text-secondary` reference fixed, fallback drift reconciled to dark-base values);
  a new lint scan extends CSS-token ownership to the dogfood plugins.
- **Docs as one current snapshot.** plugin-contract reconciled (shipped items no longer
  "planned"; pivot annotations rewritten; `getInlineContent` reframed as internal); the
  inline tier honestly contrasted with the block surface (no keymap/commands/node metadata);
  the **tier × subsystem closure matrix** added to the contract as a required checklist —
  every extension tier × every cross-cutting system (parse, focus, merge, selection paint,
  search paint, reorder, undo, clipboard, simulation), gap cells marked from the ledger.
- **The consumer example works from a fresh clone**: `src/plugins/` stays sync-generated but
  self-heals via pre-hooks; the rotted 0.9.16 tarball pin replaced by a version-agnostic
  `file:../..` link (smoke-verified to still install the real packed tarball in CI); seven
  stale root tarballs removed; quickstart documented.

### 0.9.19 — Selection/focus completeness + the issues-ledger work-down

The 0.9.18 follow-through (owner-directed): every block state selects, focuses, and deletes like a first-class citizen, and the known-issues ledger shrank from 19 entries to 7 — each remainder now a genuine keeper with a target or rationale.

- **A childless opaque container inside a cross-block selection paints the full-block overlay.** SelectionOverlay's container gate deferred painting to child hosts that don't exist for a childless plugin block (mermaid showed nothing while selected); the gate now defers only when child hosts exist. Same-class gap in MatchOverlay recorded (design call pending).
- **The error/loading/no-renderer mermaid states are no longer caret traps.** Each non-rendered steady state mounts a focusable surface; a `composeWholeBlockFocusSurface` choke point falls back to the block's box (devWarn, once) so no future plugin render-state can strand the caret; committing a source fix from the error card hands focus across the async card→viewport swap (third latent defect, found while pinning the recovery path).
- **Range-delete ceremony unified at one choke point.** The table branch emptied covered containers child-by-child before deleting them — corrupting any undo snapshot holding the detached node (red-first) — and now shares the chrome branch's subtree-root + identity-gated ceremony (`range-delete-ceremony.ts`); the prose branch consumes the same gated delete.
- **Structurally-noop commits no longer mint dead undo entries or events** — opt-in discard from the structural cores (metadata commits legitimately no-op and still commit), rolled back as the benign twin of the commit-throw path.
- **Directive rebuilds preserve CRLF** — the authored line ending rides directive metadata through `serializeDirective` (generic, callout, admonitions; details' HTML rebuild remains ledgered).
- **Attribution axes fixed after ~11 versions**: the 9 failing axes focused the document's LAST block, which windowing had unmounted — keystrokes landed on `<body>` and the settle hung; the ledger's byte-length diagnosis was falsified. Axes now focus an asserted-mounted block 0 (harness-only; the perf gate already did this — sibling-path parity).
- **Simulation coverage caught up with 0.9.18**: caret-entry reveal walk-through and edit-commit detours, mermaid focus/two-step-delete/Enter detours — plus a silently-broken `editInlineMath` gesture (its click missed the KaTeX hit-target; the content-agnostic oracle never noticed) fixed with byte assertions. MatchOverlay cell search reads a per-ancestor bucket instead of scanning all matches; `TableCellBlock` gained the sibling pending-cursor guard; LaTeX A2 (edit one of N re-renders only that one) is now integration-pinned.
- **Ledger hygiene:** conformance adjudications, the watcher promotion rule, and the `deleteGranularity`/`onEdge` re-add shapes moved to their code/contract homes; stale fixed/record entries removed; new entries: dev-server SSR registrar poison (root-caused this session), MatchOverlay gap.

### 0.9.18 — Caret-entry UX: widgets reveal, opaque blocks focus

Two owner-reported caret UX defects on the plugin surfaces, each fixed as its class.

- **Horizontal caret entry into a reveal-capable inline widget opens the source reveal** (Obsidian model). ArrowLeft/Backspace from the right or ArrowRight/Delete from the left of inline math (and directive text widgets) reveals the raw source with the caret at the entered edge; walking out folds it. Replaces the widget-selected park — a state with **zero visual rendering** for math (the caret vanished, and a second Backspace silently deleted the whole formula). The dispatch keys off the same `revealSource` policy the click path already used, at one seam (`enterWidget`) covering all four sibling entry sites, including the cross-block edge landing (`selectEdgeWidget` renamed `enterEdgeWidget` — it now enters per policy). Images keep select-then-step / select-then-delete; Shift+Arrow extension never reveals; the now-dead Enter-to-reveal branch is deleted.
- **Opaque childless plugin blocks are whole-block focus targets** (`blockFocus: 'whole-block'` descriptor + a focus-el getter on the container factory — public surface, mermaid as consumer). Arrows stop on the block with a focus highlight instead of gliding past; Backspace at the start of the block below (or Delete above — the forward twin, fixed together) focuses it first, a second press deletes in one undoable commit; Enter inserts a paragraph below; Alt+Arrow reorders; clicking the diagram then Backspace deletes; keys from the plugin's own edit textarea never reach the block affordances. Previously the block was undeletable except by selection sweep: its `not-mergeable` + descriptor-editable config dead-ended the merge fallback on a childless container.
- **The editable-container backfill no longer stuffs a phantom paragraph into childless-by-design kinds.** Pre-existing: every parse→load backfilled the opaque mermaid container with a `paragraph {raw:'\n'}` child, permanently violating opaque raw↔children faithfulness — latent because no commit ever ran the checker over the node until the new Enter/reorder gestures fired `[invariant:opaque-stale-raw]`. Whole-block-focus kinds now skip the backfill (the block itself is the caret target). Miss-analysis: the backfill had unit pins for list/blockquote but none asserting it _declines_ a kind whose design is childless; the invariant existed but nothing committed over a loaded mermaid node in any suite.

### 0.9.17 — CI + contributor hardening, showcase quality

The pre-freeze collaboration prep: the repo a second developer clones has green sharded CI, a contributor front door, and a showcase whose plugins behave.

- **CI hardened.** The Playwright battery shards 4-way per run; a prod-build `perf:check` job gates the keystroke rows (environment-scaled ceilings via `PERF_RUNNER_SCALE` — local stays the tight unscaled gate); the invariant-watcher fixture is adopted by every e2e spec, so any `[invariant:…]` fire fails the spec that triggered it (the one intentional-fire suite opts out). The watcher paid for itself on its first CI run — see the detached-scope fix below. Attribution axes stay recorded diagnostics outside the gate (`docs/issues.md`).
- **Contributor front door.** Minimal `CONTRIBUTING.md` (setup, gate tiers, commit + culture pointers), a `docs/README.md` index, self-contained `docs/contributing/code-style.md` / `docs/contributing/commit-conventions.md`.
- **Editor fixes, each red-first.** Enter at content offset 0 splits instead of no-op (text kinds) or byte corruption (fenced-code opener; a third unguarded sibling seam found and closed). Opaque plugin containers decline nested reorder — dragging an inner block no longer teleports the whole container, and chrome rows carry no dead drag handles. The multi-scope commit no longer rebuilds or invariant-checks scope nodes its own mutation detached (the watcher-surfaced CI-only stale-raw fires). KaTeX renders once (`katex.min.css` beside the injected renderer — the stylesheet is documented as the consumer's responsibility). Inline-widget reveal folds on caret escape: pointerdown-owned click gesture, raw-offset boundary-inclusive containment, tick-surviving escape check, one-gesture widget switching.
- **Showcase quality.** `?plugins=1` carries the reference plugins only (fixture dogfoods classified in `src/routes/test/plugins/README.md`); admonitions/details moved to restrained gutter-rail chrome with the untitled-title wrap fixed; mermaid gained focused-only zoom/pan, double-click edit, Tab-as-indent, theme-token toolbar and overlay.

### 0.9.16 — The editable-leaf tier

The plugin platform's last big tier: **`createEditableLeaf`** on `aragonite/plugin` (pre-freeze), a text-editing plugin block with native caret/IME/undo/cross-block-selection parity — the container factory's sibling for leaves.

- **The factory.** Getter deps (`node`/`index`/`path` + `getEl()`), its own context reads — a plugin never touches an editor context key. Two modes: `plain` (always-editable, per-keystroke commits, prose undo batching, factory-owned view sync with the Chromium trailing-newline caret anchor) and `render-primary` (component-owned render↔source swap; the whole reveal→edit→blur cycle is one undo entry). Returns the `BlockComponent` surface pre-guarded for one-line re-exports, the source-element handlers, `reveal`, and `commitSource`. Block math migrated onto it as the render-primary validator — its 17 `$lib` deep imports collapsed to the public barrels, and it **crossed the package boundary** (sync manifest + consumer route + smoke; katex was already a consumer devDependency), closing the recorded block-math exclusion. A minimal `%%` memo harness kind validates plain mode e2e (typing, traversal, undo batching, selection sweeps).
- **The stuck-fence class, killed at the choke point.** A block whose edited text parses to **multiple blocks** now structurally replaces itself with all of them — the first keeps its slot identity, the caret follows the edit position into whichever block it falls in. The cram — a same-kind reparse silently writing multi-block text into one node's raw, block math's "stuck error until reload" — was reachable by built-ins too (paragraph hard-break + interrupter line, fenced-code early close), so the fix landed at the tree-op choke point and both commit bodies, not in the factory; the splice runs inside the commit ceremony with ids, refs, and snapshot stamping synced. A blur-commit no longer yanks the caret back when focus has moved on, the code block's pending-cursor restore gained the guard the split made reachable, and the split/merge reparse paths dev-warn if they ever meet the multi-block shape (sibling-path watch).
- **Keybinding widening rides along.** `KeybindingOverride.kind` widened to `AnyBlockKind`, so a consumer can scope a chord to a plugin kind via its exported kind constant.
- **Smalls: barrel re-exports, parity mirrors, memo caps.** The CommonMark fence matchers (`matchFenceOpen`/`matchFenceClose`, now capturing the verbatim indent/info bytes a byte-exact rebuild needs) and `normalizeLineEndings` joined `aragonite/plugin` — the mermaid reference plugin dropped its fence-rule copy for them, striking two wall-ledger items. Two sibling-path-parity mirrors landed: the inline scanner's fast-bail `w`/`W` arm probes the plugin-trigger registry like its `:` sibling, and `lineInterruptsParagraph` carries the grammar-read seam duties (registration flush + consumed latch) its `getOrderedOpeners` sibling does. The dogfood math and mermaid render memos are LRU-bounded.

### 0.9.15 — Mermaid reference plugin

The first **reference plugin**: a `mermaid`-fence diagram block written as a first adopter would write it — every import from `aragonite/plugin` — validating the "render-primary block with plugin-owned editing" recipe for blocks whose content renders as a picture (diagram, canvas, embed) rather than text.

- **The recipe, validated live.** A fence-claiming opener priced ahead of `fencedCode` (a superset matcher, so the claim must run first; declining returns the fence untouched); an **opaque container with no children** whose code and fence bytes live in typed plugin metadata, `rebuildRaw` re-emitting the exact bytes; edit mode as a plugin-owned `<textarea>` committing through the container factory's `updateOwnMetadata` — one undoable entry, byte-exact in `getSource()`. The renderer is injected (`mermaidPlugin({ renderer })`; `mermaid` stays a devDependency), memoized per code text, parse failures rendering a legible inline error; absent a renderer the block shows its code statically. Pan/zoom on the rendered SVG and a fixed-position focus overlay (button + a minted `mermaid.focus` command on `Mod+M`, Escape closes) prove interior interactivity inside the component's own DOM. Uninstall safety is by construction — without the plugin the same bytes parse as plain `fencedCode` — pinned by a fast-check round-trip property over adversarial fence shapes (CRLF, `~~~`, missing closer at EOF, indented fences, unicode) in **both** install states. Written up as the plugin guide's render-primary recipe.
- **Findings, honestly.** `updateOwnMetadata` was reachable and sufficient — the anticipated metadata-commit gap did not exist. Two real walls: the built-in fence matcher isn't on the barrel (a fence claim reimplements the CommonMark fence rules), and a childless container dead-ends the factory's caret traversal with no public focus-actions seam — the reference block ships `focusable: false` (arrows glide past; mouse and commands reach it), and block commands need a plugin-owned node→component bridge for view-state (no component channel on the command context). The general editable-leaf tier remains the roadmapped answer for editor-native code editing.

### 0.9.14 — Component-portal inline widgets

A plugin can now supply a **Svelte component** as an atomic inline widget instead of hand-building DOM — the recommended inline-widget path — made churn-safe under the editor's rebuild-everything-per-keystroke render by a keyed reuse pool.

- **The `component` descriptor field.** `registerInlineWidgetKind` accepts a `component` (mounted with frozen `{ inline, source }` props) as an alternative to `buildWidget`; declaring both throws, naming the kind. The render layer wraps the component in the atomic island — stamping the `data-inline-widget` / `data-source-*` / `contenteditable=false` marker attributes the cursor and selection machinery key on — and mounts it through an injected portal builder, so `core/` stays framework-free. `InlineWidgetComponentProps` is on the `aragonite/plugin` barrel.
- **The keyed reuse pool.** One live instance per `(kind, source)` survives a block's per-keystroke rebuild: typing next to a widget adopts its instance (offsets re-stamped) rather than remounting it, and an instance is remounted only when its source text changes. `mount`/`unmount` from Svelte enter the repo for the first time, contained to this seam; a synchronous mount throw is caught and routed to the editor's `error` channel (`origin: 'render'`, by path), the widget falling back to its raw source. The pool is imperative string-keyed state, never reactive — the render path reads no cache. Wired on both render surfaces (paragraph prose and table cells); the source-reveal cancel restores the exact element it detached, so byte-identical duplicate widgets and mount identity survive reveal→Escape.
- **KaTeX inline migrated as the validator.** Inline `$…$` renders through a `MathInline` component instead of the hand-built shell; the injected renderer (`latexPlugin({ renderer })`) reaches it by module wiring, and its memoization still spans the document. The migration proved the seam end-to-end: adoption keeps a formula's mount identity stable across adjacent typing and mints a new one on a source edit.

### 0.9.13 — The plugin unit + paste conversion config

The authoring registrations gain an installable **unit**, so a consumer wires an extension by passing it — not by hand-ordering `register*` calls behind idempotence guards.

- **`definePlugin` + `plugins` prop.** `definePlugin({ name, setup })` packages a plugin's global registrations; the editor's set-once `plugins` prop installs each once per process, before the instance's first parse. `installPlugins` on the main barrel is the editor-less entry for `parse()` pipelines; `isPluginInstalled` probes an install. Semantics: once per process keyed by name — same-identity re-install no-ops, same-name/different-identity is first-wins with a dev-warn (`name@version` when versioned), a failed setup stays failed (reload to retry). Kind declarations made during a setup are attributed to their plugin, so a duplicate-registration error names the first declarer.
- **All four dogfoods + the consumer examples migrated.** Callout, details, LaTeX, and admonitions are factory exports now (`calloutPlugin()`, `detailsPlugin()`, `latexPlugin({ renderer? })` — LaTeX gains renderer injection — `admonitionsPlugin()`), each installed through the prop; the boundary-clean consumer examples install the same way. Per-plugin config rides the factory, and the unit owns idempotence — the per-call registration guards are gone from the authoring model.
- **Staggered mount pinned by e2e.** A second editor can mount carrying a plugin the first never had: the late install serves the new editor's own parse, while the already-parsed editor does not re-parse (the late registration dev-warns).
- **Content-keyed paste transforms.** `registerPasteTransform` records a named, pre-parse rewrite of pasted plain text — run in install order at every paste site, each declining (`null`) or replacing the clipboard text before the parse. Paste-scoped and content-keyed (distinct from the still-internal, target-kind-keyed `registerPasteSurface`), attributed to the owning plugin, with a dev-warn on a non-idempotent transform to catch paste feedback loops. The admonitions dogfood migrated its GitHub-alert → `:::name` conversion onto it (fence-safe, parse-scoped); the host convert button stays for loaded documents. Closes the clean-room build's one honest gap — the conversion-config seam the `registerPasteSurface` rejection pointed to, shipped a milestone early.
- **Docs reconciled.** The plugin guide teaches the unit as the authoring model, the consumer guide gains a Plugins section, and the plugin contract moves the `plugins` prop from designed-ahead to shipped pre-1.0 (declarative manifest, scaffold, hot-reload, and reference fleet stay 1.2).

### 0.9.12 — Clean-room freeze validation

Roadmap items 1+2, completed. The plugin API's _discoverability_ — what the DX thesis actually rests on — tested under third-party conditions, and the package boundary now carries the plugin surface as a permanent gate.

- **The clean-room build.** A walled-off author with ONLY the packed tarball and the public docs pack built a full admonitions extension: five directive kinds, editable titles, per-kind styling, an undoable kind-switch chord, GitHub-alert conversion, byte round-trip including the plugin-uninstalled fallback — one support question in the whole run, zero dev-console warnings. Promoted as the third reference extension (`src/routes/test/plugins/admonitions/`) with its own e2e battery on the new shared plugin-spec helpers.
- **The paste forcing function fired, honestly.** `registerPasteSurface` exposure **rejected** with evidence: the target-kind-keyed hook cannot serve content-keyed pre-parse conversion, and its type closure drags commit-coordinator machinery public. The missing seam is the 1.2 conversion config — now empirically validated by a real consumer need — and the feature shipped on the documented document-rewrite pattern (`getSource()` → transform → `source` re-sync) instead.
- **Package boundary gated.** Every boundary-clean dogfood (callout, details, inline math, directives, admonitions) builds and runs through the packed tarball in `examples/consumer` — a sync step with a fail-loud `$lib` rewrite gate, per-extension smoke specs with plugin-discriminating assertions, and a dev-guard project proving the devWarn channel crosses the boundary under `vite dev` (and stays silent in a production build). Block-math stays repo-side by design (post-1.0 editable-leaf dogfood; recorded in issues). Tarball contents audited: encapsulation is exports-map-level, kept deliberately.
- **The public docs pack.** `docs/guide/plugin-guide.md` — the authoring entry point, every barrel export covered and pinned by a coverage guard test — plus a pack builder with a dead-link validator (minted after review caught the wall-grep's blind spot). Support-channel findings shipped as docs: the mutation/paste boundary, the serialize composition contract, the chord model, chrome empty-state guidance, and directive-name first-wins arbitration. The callout dogfood dropped its one deep import via the new public `isDirectiveRegistered` probe.

### 0.9.11 — The `:::name` directive primitive

Roadmap item 1 (sub-project B), completed. One shared opener owns all `:::`/`::`/`:` fences and dispatches by name into the editor's kind system — so N plugins never collide on opener priority. The remark-directive model, adapted to the CST's byte-lossless round-trip.

- **Three tiers, one grammar.** Container (`:::name … :::`, nested block children), leaf (`::name`, single-line block), text (`:name[label]{attrs}`, an atomic inline widget with source-reveal on focus). Colon count is the tier boundary; container nesting uses fence-length, like fenced code.
- **Dispatch by name, lossless fallback.** A registered `(tier, name)` resolves to the plugin's own first-class kind (full descriptor power); an unregistered name round-trips **byte-for-byte** through a generic fallback kind and renders generically — a document survives its plugin being uninstalled. `registerDirective` validates per tier (container requires a factory, text is kind-only).
- **Public activation.** `activateDirectives()` on `aragonite/plugin` — an explicit, idempotent, call-based activation (no magic side-effect import); a barrel import alone never claims `:::`. The `:::note` callout dogfood migrated onto the primitive (its hand-rolled opener deleted), proving the primitive subsumes the per-plugin-opener path.
- **Proven byte-lossless.** A `fast-check` adversarial round-trip property (all tiers, nesting, non-ASCII, registered + unregistered) with a rebuild-inverse that catches faithless fence-byte capture, plus a directive simulation gesture putting the surface under the corruption oracle. `parseDirectiveAttributes` is an opt-in `[label]{attrs}` reader. Authoring guide at `docs/guide/directives.md`.

### 0.9.10 — Inline-widget editing registry + KaTeX

The third plugin authoring seam: the image live-widget path is generalized so a plugin inline kind gets atomic caret-addressing, with KaTeX as the driving first-party consumer.

- **`AnyInlineKind` widening + inline-widget editing registry.** Plugin inline kinds thread through the model (mirroring `AnyBlockKind`) via `INLINE_KIND_TABLE` and an unknown-inline fallback; `registerInlineWidgetKind` / `augmentInlineWidgetKind` carry per-kind editing policy. The widening the roadmap flagged breaking-if-deferred-past-freeze is decided.
- **Inline-syntax recognition hook.** `registerInlineSyntax` hands the scanner a trigger character and a recognizer — gated (dormant unless registered, conformance byte-identical), the designed seat for the 1.2 inline-syntax consumers.
- **Shared source-reveal editing primitive.** Atomic inline widgets contribute raw bytes via `data-source-start`/`-end`, are caret-addressable only at their edges, and reveal editable source on focus (caret/tick core + injected swap).
- **First-party KaTeX extension (dogfood).** Inline `$…$` (select→reveal-source) and block `$$…$$` (render-primary, source-on-focus); renderer injected, not bundled — verified out of `dist`. Nine interface findings routed to `docs/issues.md` + `plugin-contract.md`; `deleteGranularity`/`onEdge` trimmed as unconsumed (re-add additively with the inline-entity consumer).

### 0.9.9 — Inline scanner rework: the CommonMark delimiter/bracket-stack pass

Roadmap item 1, cut over whole. `parseInline` is a single left-to-right scanner (`core/inline/scan/`) — character dispatch feeding a delimiter stack (flanking, `openers_bottom`, original-run-length multiple-of-3) and a bracket stack (innermost-wins links, spec destination/title parsing) — and the staged pre-pass pipeline is deleted.

- **Deliberate-only conformance.** Baseline 71 entries / 11 classes → 9 / 3, each with a recorded reason: astral flanking (we follow the spec's code points; commonmark.js reads UTF-16 units), GFM bare autolinks (the reference is CommonMark-only), and image alt as raw label bytes (the display model). Six classes converged outright; zero previously-agreeing inputs regressed across the full corpus. Two audited normalizer reconciliations (spec §6.1 code-span folding, §6.8 softbreak trimming — aragonite side only, the reference AST is already spec-folded) carry the styled-source byte model.
- **Proven before cutover.** The full unit suite passed against the new scanner under a temporary flip with every discrepancy triaged; the 0.9.6 inline stopgaps retired structurally (the link-in-code-span corruption class and the delimiter-rule patches are unrepresentable in the stack architecture; scan bounds live in the shared cores). A total-coverage property (G2.11) pins the node contract — every byte in exactly one node's range.
- **Faster:** ~2.2× the old pipeline over the slice corpus; every `perf:check` gate row at or better than pre-cutover. The scan dispatch table is the designed seat for the 1.2 inline-syntax hook; nothing exported yet.

### 0.9.8 — Conformance harness + registry hardening

Roadmap item 1's de-risk step and item 2 in full: the inline-scanner rework now has its convergence meter, and the registries limestone will bind to fail loud at the registration seam.

- **commonmark.js conformance harness** (`src/lib/test/conformance/`). Both parsers normalize to one minimal inline shape — unmapped constructs throw, and deliberate reconciliations are recorded in the baseline's audit array — diffed over three corpus strata (inline-only spec examples, brute-force enumeration, seeded random). A like-for-like guard (commonmark sourcepos full-input-span) skips inputs the reference's _block_ layer trimmed or consumed, with per-reason skip accounting, so every divergence is inline-semantic. Two tiers: a deterministic slice rides `npm test` against a committed baseline that fails closed in **both** directions (new divergence fails; stale entry fails until removed), and `npm run conformance:full` is the env-gated sweep meter — 182,160 inputs compared, producing the scanner-rework work list. The reference is pinned exact at commonmark 0.31.2; bumping it is a deliberate re-bless.
- **Registry coherence moved to the registration seam (G1.17).** The startup-once, dev-only sweep became per-registrant checks flushed at mount or the next grammar read — never mid-registration-batch, so intra-batch forward references stay warn-free — and an opener registered after documents have parsed dev-warns naming the kind (late registration stays legal: the 1.2 `plugins`-prop staggered mount is a real flow). Opener dispatch order is now a pure function of declarations (`priority`, then kind) so module-load order can never matter; equal priorities still warn as name-arbitrary.
- **Coherence derives from live registries.** A plugin keymap's command ids validate against minted `PluginCommandId`s (the built-ins-only gap is closed), and `reservedChrome` declarations get bootstrap coherence (G1.18): the declarer must be a container and its chrome kind must resolve to a registered descriptor and component.
- **Grouped container registration.** Container-only descriptor fields register as one `container` unit (`BlockKindRegistration`); `rebuildRaw` is required inside the group, so the container/rebuild pairing violation is structurally unrepresentable — G1.3 retired upward (guarded → unrepresentable) and its predicate deleted. Both write seams also strip container-only keys from widened flat objects, closing the structural-typing escape the type pins can't see. Built-ins and both dogfood plugins migrated.
- **`ContainerBlockListProps` inverted.** The container-seam props type is now an authored contract with a two-direction compile-time conformance check; an internal BlockList prop edit fails `npm run check` at the contract instead of silently rewriting the public shape.

### 0.9.7 — Command mint: plugin block-commands + registry fail-loud

Roadmap item 1. A plugin mints a command id, binds it to a kind's keymap, and the container-bubble dispatch runs it — the first increment of a unified command registry — plus the two P0 registry fail-loud fixes the freeze needs.

- **Plugin command mint.** `registerBlockCommand(kind, name, handler)` on `aragonite/plugin` mints a branded `PluginCommandId` and registers a `(kind,id)` handler; `AnyCommandId` threads plugin ids through the keymap/override/dispatch types (mirroring `AnyBlockKind`). The `:::note` callout gains a `callout.setKind` command bound to `Mod+7`/`Mod+8`, validating mint → keymap → bubble dispatch → handler → metadata commit → the existing `metadataUpdate` op end-to-end — no new op kind. `BlockCommandContext` and the handler shape join the pre-freeze plugin surface; plugin-op vocabulary stays deferred (metadata edits already emit `metadataUpdate`).
- **Bubble dispatch single-sourced.** `dispatchKindCommand` is the one seam every container-bubble keydown routes through — resolving the registry, else the container's `runCommand`; the built-in list/blockquote/table containers migrated onto it, deleting the per-container duplication. The container factory supplies the command context (routing `updateMetadata` to `updateOwnMetadata`). The leaf path widens types and dev-warns a dead plugin-command key; its registry tier is deferred to a driver (built-in-command migration + the command palette are the unified-home follow-up).
- **Two P0 registry fail-loud fixes.** `registerInlineWidgetKind` throws on duplicate — a plugin can no longer clobber the built-in `image`/`rawHtml` widgets process-globally; `augmentBlockKind` rejects built-in kinds via a structural `augmentBuiltin` seam kept off the public surface, closing the silent built-in-descriptor-rewrite path. Miss-analysis: the sibling entry-layer registries lacked the register-once / augment-guard tests their peers already had.

### 0.9.6 — Review hardening: corruption fixes, path-dialect unification, contract quick-wins

A full four-pass audit (every Critical/Important finding independently verified) followed by
reviewed fix waves. Three byte-corruption classes closed, one deadline-bound restructure landed
before the 1.0 freeze, and the plugin surface met the corruption oracle for the first time.

- **Selection × tables no longer corrupts the CST.** Table-endpoint normalization moved inside
  the selection state (`enterCrossBlock`/`extendFocus` — the sixth entry path can no longer
  miss it), closing two hand-reachable corruption gestures (double Ctrl+A with a table at a
  document edge; shift-click between paragraph and cell). Shift+ArrowUp from a container's
  first leaf no longer extends downward; cross-block delete holds a re-entry latch; table
  endpoints join the multi-scope commit so whole-row snaps keep row ids stable (the standing
  table-kind audit exclusion is gone).
- **Inline parser stopgaps** (the full CommonMark delimiter/bracket-stack rework is
  roadmapped): a link destination can no longer terminate inside a code span (typable
  byte-corruption via `textContent ≠ raw`); the emphasis multiple-of-3 gate reads original run
  lengths (divergence vs commonmark.js: 865/72,702 → 0); bracket nesting is depth-capped;
  entity and paren scans are bounded; a GFM header/delimiter count mismatch now rejects the
  table per spec instead of silently truncating header cells.
- **One path dialect on the public event channel.** Commit scopes mint doc-absolute event and
  undo-snapshot paths at the seam (factories, not call sites) — nested ops no longer emit
  scope-local paths, no-caret undo restores land for click-driven container ops, typing in a
  container-nested link-reference definition rebuilds the resolver map, and a dev guard
  (G1.16) makes the next dialect drift loud. Landed pre-freeze on purpose: the `edit` channel
  is what external consumers bind to at 1.0.
- **Plugin contract quick-wins (pre-freeze, user-approved).** `parse`, `serializeChildren`,
  `trimTrailingLineEnding`, `declaredPluginKind` (kills the cast ceremony), typed
  `BlockComponentProps`/`ContainerBlockComponent`, and registry probes for kind/component/
  opener on `aragonite/plugin`; collapse-ness single-sourced from the declared probe (window
  clamp and height oracle derive from it — a collapsed container estimates one chrome row);
  dev guards for misbehaving openers (G1.15) plus a misuse-outcome table in the contract doc;
  `KeyBinding.arg` widened for the coming command mint; the uncallable `registerCommand`
  export removed until the mint lands.
- **Interaction/a11y fixes.** Focus and reveal skip failed-render blocks instead of hanging;
  the stale top-level reveal ref is fixed with a deterministic guard; keyboard reorder works
  for code blocks and thematic breaks; table alignment restores focus and announces; Ctrl+F
  works with CapsLock; structural paste lands the caret at the end of pasted content; pasted
  unordered items adopt the destination list's bullet on every paste route; case-insensitive
  search is fold-safe (İ) and a new query starts at the first match.
- **Theming made real; tooling unblocked.** The eleven documented `--syntax-*` tokens are now
  actually read (visually neutral by construction — consumer overrides work without changing
  the shipped look); undeclared token reads fixed; the css-ownership lint catches off-family
  tokens; the perf gate finally has launchers (`perf:check`/`perf:editor`/`perf:e2e`);
  plugins/simulation area scripts; CI caches browsers; the consumer-smoke pack pin self-heals
  across version bumps.
- **Structure + test infrastructure.** `editor-actions/` reorganized (`commit/`, `focus/`,
  `plugin/`; the layer's one upward value edge removed at the barrel seam); an invariant-
  watcher Playwright fixture (invariant fires now fail adopted specs); the two largest spec
  files split 4-way each; a plugin-ops simulation profile — the strongest corruption oracle's
  first contact with the plugin surface, green; nine requirement files backfilled; an
  adversarial parser pin corpus with widened property generators (non-ASCII,
  cross-construct).

### 0.9.5 — Details/collapsible: the second chrome consumer + first-class collapse

The `details`/collapsible dev-harness plugin validated the reserved-chrome contract as its second real consumer — zero internal reach-ins for the component, SSR + hydration clean with interactive chrome — and collapse landed as first-class machinery.

- **The `<details>` kind** — a narrow canonical form claimed ahead of the htmlBlock opener (non-canonical HTML declines back to it), the summary as a chrome child, and `open` metadata round-tripping `<details>` ↔ `<details open>` byte-for-byte.
- **Collapse is a windowing clamp** — a collapsed container renders only its chrome row through the existing windowing machinery: the body genuinely unmounts (O(viewport) preserved), and reveal into a collapsed body degrades to the summary _without editing the document_.
- **A declared collapse probe** — `reservedChrome.isCollapsed` on the container descriptor makes every child-adjacency operation collapse-aware as a class: merge-from-below stops at the chrome instead of writing into the hidden body, arrows exit the summary, and Enter cannot mint invisible paragraphs.
- **Chrome × table composition closed** — cross-block ranges involving tables inside a chrome container's body now honor the chrome wall (clear, never delete); a latent identity bug in the table branch's nested-endpoint path was fixed in the same pass.
- **Clipboard** — a cross-block copy ending mid-title/summary now emits reparseable container bytes via the kind's own raw rebuild over a synthetic chrome node (the start-in-chrome direction is recorded for the post-1.0 clipboard generalization).
- **Promotion finding** — both consumers independently need the same three core helpers (`parse`, child serialization, line-ending trim); they are promotion candidates for the plugin surface when the tarball gate forces the decision.

### 0.9.4 — Plugin authoring: containers, editable chrome, the reserved-chrome contract

The first real plugin-authoring surfaces, exposed **pre-freeze** on the `aragonite/plugin` subpath and dogfooded by a `:::note` callout dev-harness plugin (`/test/plugins`). Design records: `docs/design/plugin-contract.md` (pre-freeze surface + boundary), `docs/issues.md` § Plugin containers (known deferrals).

- **Container authoring** — `createContainerBlock` wires a nested-`BlockList` plugin container (list state, ancestor contexts, nested actions, windowing, the `BlockComponent` surface) in one factory, so a plugin container is as thin as the built-in blockquote. Plus typed plugin metadata accessors and idempotent-registration probes.
- **Editable chrome** — `registerChromeLeaf` registers a container's editable title/summary leaf in one call, with a default keymap (Enter descends to the body; chord-keyed caller overrides). `contextDependentKind` makes recognizer-less kinds keep their kind through content edits (generalizing the hardcoded tableCell skip); `containerContract: 'opaque'` names containers whose raw is authoritative rather than a strip decomposition.
- **The reserved-chrome contract** — a container declares its chrome slot (`reservedChrome` on its descriptor) and the machinery enforces it: **always present** (backfill re-mints the chrome kind), **single-line** (unsplittable; the built-in `chrome.descendToBody` Enter; paste flattens inline ahead of the container-paste family), **cleared, never node-deleted** by cross-block ranges (a chrome wall in range deletion — nothing merges raw across the container boundary), and **kind-stable**. Validated by a selection spike first: chrome modeled as a real child node inherits cross-block selection, caret, and undo natively, with zero selection-layer changes.
- **Guards** — new dev invariants for opaque-container staleness, rebuild determinism, and the chrome slot; the plugins e2e project now fails on any dev-invariant fire. One known composition gap (table endpoints bypass the chrome wall) is logged and owned by the `details` cycle.

### 0.9.3 — Library packaging + external consumer harness

The editor became an installable package, proven from outside the repo.

- **Packaging** — `svelte-package` build with an `exports` map covering the component barrel, the `aragonite/plugin` subpath, and the theme CSS; `svelte` as a peer dependency; the dist pruned of test files; a verified `npm pack` artifact.
- **External consumer harness** — a durable `examples/consumer` SvelteKit app installs the packed tarball (not `$lib`) and imports only public entry points; the editor server-renders and hydrates cleanly.
- **CI `consumer-smoke`** — packs, installs, type-checks, SSR-builds, and smoke-tests the consumer on every PR, making the public API's from-outside usability a standing gate.

### 0.9.2 — Table mouse affordances

Pointer and contextual-menu editing for tables, pairing with the keyboard chords so table editing is no longer keyboard-only.

- **Hover grips + drag reorder** — hovering a row or column reveals a grip; dragging it reorders that row or column (a single insertion line, autoscroll to reach off-window rows and wide-table columns, one commit on release), and clicking it opens a row/column action menu.
- **Contextual menu** — the grip menu and a right-click on any cell open the same menu: insert/delete row and column, L/C/R column alignment, and cut/copy/paste for a cell. It also opens from the keyboard via Shift+F10 / the Context Menu key.
- **Keyboard column reorder** — Alt+←/→ moves the focused column one slot, mirroring the Alt+↑/↓ row reorder.
- **Menu nav + announcements** — full arrow / Home / End / Esc keyboard navigation of the menu, with screen-reader announcements. Two caveats noted in the consumer guide: menu Cut/Copy write rendered cell text (vs. the keyboard raw-source slice), and menu Paste depends on `navigator.clipboard.readText()`.

### 0.9.1 — Pre-1.0 polish: theming for extraction, consumer docs, hygiene

Module-readiness polish ahead of the standalone-repo extraction.

- **Theming scoped for extraction (single-flow).** All tokens moved off `:root` to the editor's own scope (`.editor`, plus an opt-in `.aragonite-editor-theme` class for non-editor chrome), so the module no longer injects custom properties into a consumer's global scope and a consumer themes the editor through one channel — overriding tokens at the editor scope. Light/dark keys on a `data-editor-theme` attribute driven by a new `theme` prop (`'dark'` / `'light'` / custom name), replacing the global `:root[data-theme-type]` toggle. The `--color-*` chrome tokens gained light+dark defaults too, so the editor (search bar, image, code backgrounds) renders correctly in both modes host-less. The limestone consumers drive the prop from the active app theme via a new `currentThemeType` store, so the in-app editor follows app light/dark.
- **Consumer guide completed.** The `getSearch()` controller and `searchBar` prop, the named CST utilities (`parseInline` / `getContentRange` / `isProseKind`), the `EditEvent` / `EditorError` payload envelopes, a minimal mount example, and the theming scope/toggle/override contract.
- **Hygiene.** Dimmed-marker opacity tokenized (`--syntax-marker-dim`); code/mono surfaces unified on `--font-editor`; the `/test/editor` route gained a landing affordance and lifted its `window.__test` probe surface into a module. List indent/promote now adopt the destination bullet glyph within the unordered axis.

Internal only.

### 0.9.0 — Remaining GFM + public API

Closed the last CommonMark autolink gap and made the editor's public API truthful, per-instance, and overridable.

- **Angle-bracket absolute-URI autolinks.** `<scheme:…>` for any valid scheme (`<ftp://…>`, `<mailto:…>`, custom) now autolinks — the former `http(s)`-only recognition generalized to the CommonMark absolute-URI grammar, closing the one §6.8 gap.
- **Keybinding-override prop.** A per-instance `keybindings` prop rebinds, adds, or disables bindings over the built-in command vocabulary without forking, consulted ahead of the built-in keymaps at every dispatch site. The override map flows through context (no module-global mutation), so two editors can carry different bindings; the full `CommandId` vocabulary and the chord format are exported as public types. Undo/redo chords are overridable too — the input-layer history interception (which suppresses native browser undo) now routes through the override-aware dispatch with precise chord matching, fixing a loose key check that also mis-caught Ctrl+Alt+Y as redo.
- **Public-API truthfulness.** The production consumer and the demo import `Editor` from the `$lib/editor` barrel (proving extraction is mechanical); `EditorSelection` and a named `EditorInstance` handle are exported; `EditorProps` is single-sourced so the component consumes its own published type and can't drift, guarded by a compile-time conformance check.

### 0.8.10 — Perf attribution + flat-shape gate

Closed out the 0.8 performance line. Measurement overturned the working model: the apparent flat high-block-count keystroke residual was a harness artifact, not editor cost.

- **Flat keystroke is O(viewport).** The latency harness settled each keystroke by summing `docLengthInPage` over the whole `$state`-proxy children array (O(children) per poll), inflating flat high-block-count rows — many-small-blocks-10MB read 231ms where the editor cost is ~3ms. Attribution (`axisS`: mounted/renders/CDP-ScriptDuration flat across 1k–30k blocks) confirmed windowing fully bounds the keystroke; fixed the settle to read the edited block's own length term.
- **Flat shapes now gated at 10MB.** With the artifact gone, `perf:check` enforces every renderable shape's 10MB keystroke (flat 10MB rows were previously excluded for the now-removed artifact). Baseline re-blessed.
- **Sticky-nav scan bounded.** `findOffsetNearestX` scanned every offset in the block; it now scans only the probed visual line's neighborhood (O(lines-near-edge), not O(raw length)), so sticky Up/Down through a giant paragraph no longer measures a rect per character.
- **Two limitations accept-documented** (`docs/design/performance.md`): the intra-block single-giant-paragraph keystroke (Axis 5 — O(paragraph-length) span rebuild, ~177ms prod @ 1MB; synthetic and transient — Enter splits the paragraph), and flat load (O(node-count) reactive-tree materialization, sub-second at realistic sizes, ~22s only at the 392k-block 10MB extreme).

Internal only.

### 0.8.9 — Editor quality pass

A batch of editor polish across reorder, find/replace, and link safety.

- **Keyboard table-row reorder** — Alt+↑/↓ inside a cell moves the focused body row one slot among the body rows (building on 0.8.7 block reorder): one identity-preserving structural reorder, a single undo entry, focus following the row in its column, and a live-region announcement. The header row is positionally fixed; a boundary press is a no-op. Keyboard-only; the drag affordance is roadmapped.
- **Find/replace polish** — undo after replacing nested content restores the caret to the exact nested leaf (list item / table cell), not the top-level block; a zero-width regex match (`a*`, `^`) no longer paints an invisible highlight sliver.
- **Default link activation hardening** — the editor's default link handler is now policy-gated through the scheme allowlist (`isAllowedHrefScheme`), so a host that supplies no `onLinkActivate` won't open a `javascript:` / control-byte URL by default.

Internal only.

### 0.8.8 — In-document find/replace

Find and replace within a document: a toggleable top-right floating bar plus a public engine API. Search is a read-only lens over the CST — scanning and highlighting never mutate the tree, parser, or inline cache.

- **Engine** — a pure `search/` module scans editable leaves for matches (case / whole-word / regex toggles; regex with `$1` capture refs and an invalid-pattern error state), keyed by block path. Container raw and ambient prefixes are never scanned.
- **Highlighting** — a per-block `MatchOverlay` (sibling to the selection overlay) paints matches through the existing `measurePartialRects` hook, so windowing bounds highlight cost to the viewport. Table cells, which render outside the block-host path, paint as whole-cell highlights via a selection-independent `cellRect`.
- **Replace** — per affected top-level subtree, the substituted source is reparsed and committed as one identity-preserving `replace`, batched into a single undo entry; cost is O(affected), not O(document), and untouched top-level blocks keep their identity. Table-cell replacements escape `|` and newline so a row can't be split. Replace and Replace All; regex replacements expand `$1`/`$&` and `\n`/`\t` escapes.
- **Bar + API** — `searchBar` prop (default on) renders the built-in bar (Ctrl+F find, Ctrl+H replace, Esc closes and restores focus); `editor.getSearch()` exposes the controller so a consumer can disable the bar and drive a custom UI. Re-scan runs only while the bar is open, deferred off the keystroke path (zero added keystroke cost). Known limitation (`docs/issues.md`): off-window rows of a windowing-active giant table don't re-measure highlights — shared with the selection overlay.

Internal only.

### 0.8.7 — Block reordering

Move a block among its siblings — top-level blocks, list items within their list, and a blockquote's children — over one structural reorder operation reachable two ways.

- **Keyboard** — Alt+↑/↓ nudges the focused block past a sibling, with a screen-reader live-region announcement of the new position. Always available.
- **Mouse drag** — a hover handle (revealed on the innermost reorder host only) drags the block; a ghost follows the pointer and a single insertion line marks the drop gap, with no mid-drag reflow and one commit on release. Escape or pointer-cancel aborts cleanly. The handle is consumer-toggleable via `blockDragHandles` (default on).
- **Off-window targets via autoscroll** — drop hit-tests against mounted siblings, so a target below the fold is reached by holding the pointer near the viewport edge to autoscroll it into the window, not by spacer-region hit-testing. There is no precise off-window drop; this is the intended reach for large, windowed documents.

### 0.8.5 — Lazy `inlineContent`

The inline tree — a derived Phase-2 rendering cache — moves from eager to cost-on-read, consistent with container-raw (0.7.4) and virtual rendering (0.8.6): inline cost becomes O(viewport-rendered + on-demand-touched), not O(document).

- **Cost-on-read accessor** — non-render consumers read inline content through an accessor backed by a node-keyed, non-reactive WeakMap, validated on read by `raw` plus the link-reference signature (no dirty flag; a shared/unchanged node hits, a copy-on-write or in-place `raw` change misses and recomputes). The render path computes locally and caches nothing.
- **Eager work deleted** — the whole-document inline sweep at load and per commit is gone, along with its `inline-dirty-set` scoping; undo/redo and link-reference edits no longer re-parse the document inline, and the common keystroke no longer double-parses the edited block.
- **LRD-map rebuild gated** off the keystroke hot path — the link-reference map rebuilds only when a commit could change the reference set, not on an ordinary paragraph keystroke.
- **`inlineContent` removed from `CstNode`** — accessor-only, which narrows the 0.8.3 plugin freeze before any plugin binds (see `docs/design/plugin-contract.md`). The retired render-path corruption guard (G4.2) downgrades to a perf-hygiene lint — with no reactive cache field, the read/write cycle it guarded cannot recur.
- **Scale gate un-capped** — the giant-single-list/blockquote/table fixtures, capped at 1MB on a stale (never-measured) assumption their 10MB load wouldn't complete, are now measured and gated at 10MB: load is linear and windowing bounds the mount, so the keystroke is O(viewport). reference-heavy un-caps too (lazy inline removed its keystroke's whole-document sweep).
- **0.8.1 incremental parsing dropped** after measurement — parse is a small linear fraction of load and structural edits already re-parse per block, so block-level incremental parse addressed no measured cost. Its one residual is the long-single-paragraph intra-block axis (Axis 5), tracked separately.

### 0.8.3 — Plugin-API contract freeze (foundation)

Freezes the foundational plugin-facing contract — the shapes external plugin code binds to at 1.2 — while changing it is still cheap, before any binding. Not exposed from `index.ts` yet; 1.2 flips the switch. Design record (with the breaking-if-deferred vs additive-later decision table that justifies the scope): `docs/design/plugin-contract.md`.

- **Node identity** — `CstNode.kind` widens from `BlockKind` to `AnyBlockKind` (built-in union + branded plugin kinds), so a plugin-kind node is a first-class CST citizen through render, measure, and serialize. A structural `isBlockNode` guard (`'raw' in node`) replaces kind-based `CstNode | Document` narrowing, which the widening made unsound (a plugin could name a kind `document`).
- **Registries are code, not state** — the five kind-keyed registries (block-kind descriptors, components, openers, commands, paste surfaces) are register-once: a duplicate registration throws (the `customElements` model), making real what `consumer-guide.md` already promised. `augmentBlockKind` stays the deliberate-merge path; no runtime unregister/replace (a Plugin System II concern). A unified test reset clears non-built-ins; registration modules are dev-HMR boundaries (a register-once edit needs a reload).
- **Plugin-kind naming** — `declarePluginKind` rejects collisions with built-in kinds, the reserved structural sentinel `document`, and previously-declared plugin kinds.
- **Events access** — `getEvents()` ratified as the canonical accessor; stale `editor.events` references corrected across the docs.
- **Scoped out, in writing** — manifest / `plugins` prop / lifecycle (target shapes, built at 1.2); the `EditEvent` snapshot/real-delta discriminant (additive, designed with its post-v1 version-history consumer — the naive `snapshot`-derived flag would mislabel ordinary typing); the 0.8.2 inline-parser hook.

Internal only.

### 0.8.2 — Inline-widget registry (consolidation)

The decision "is this inline node a live atomic widget, and how is its widget-ness recognized" is single-sourced into one `core/inline/` registry, replacing logic previously spread across a model predicate, the renderer's raw-HTML branch, the `<br>` tag allowlist, and an unenforced doc comment.

- **Recognition is registry-owned** — one predicate answers widget-ness for every consumer (vertical-skip, edge-select, cursor adjacency, clipboard, the renderer); a new widget inline kind registers rather than editing scattered branches.
- **Builders dispatch by layer** — the core `<br>` builder is registered; the image builder stays injected per-render (it carries the per-instance broken-URL cache) and is never process-global. The per-block `renderImagesAsWidgets` policy stays on the block-kind descriptor — a separate axis from kind-level widget recognition.
- Behaviour-preserving (identical widget set), internal only. This is the consolidation half of 0.8.2; the parser-stage extension hook stays open (see roadmap) — widget-ness is a render+model decision, not a parse one, so that hook awaits a real inline-syntax consumer.

### Forge-review hardening (post-0.8.6)

A four-pass review of the editor module with tiered fixes. Substantive seams:

- **Cross-block table selection** — a whole-row snap at the selection-normalize chokepoint makes highlight, copy, and cross-block delete agree on a mid-row table endpoint, closing a Cut data-loss; pointer-drag endpoints carry cell coordinates like the keyboard path.
- **Commit rollback** — a throwing container/multi-scope commit now restores each scope's pre-mutation children, so the live tree is never left partially mutated.
- **Editor-root keystroke routing** — when the caret's block is windowed out and native focus drops to the document body, a document-level listener routes cross-block and undo/redo keystrokes (focus parks on the editor root on unmount), closing undo/redo-inert-when-unmounted.
- **Editable-surface factory** — the contenteditable plumbing shared by the three editable blocks is extracted into one `createEditableSurface` factory behind a cursor-backend seam.
- **Forward-delete + list markers** — nested code-block forward-delete uses a focus-layer move-or-noop instead of a root-vs-container index mismatch; ordered markers adopt the destination punctuation on indent/promote.
- **Per-instance state** — the image broken-URL cache is per editor instance; the "global schema, per-instance state" contract is documented for consumers.
- **Test coverage + structure** — the simulation oracle now exercises tables and runs fenced-code/image round-trip checks in CI; the undo ceremony is grouped under `editor-actions/undo/` and block components are colocated per kind.

Residual: viewport-follow on an off-window cross-block extend for deep-nested lists (tracked in `docs/issues.md`). Internal only.

### 0.8.6 — Virtual rendering (windowing)

Mounted block components bounded to the viewport at every nesting depth, turning steady-state keystroke cost from O(mounted) to O(viewport). Design record: `docs/design/virtual-rendering.md`. Seams:

- **Top-level windowing** — `BlockList` self-activates (hysteresis watermarks), rendering a sliced window between top/bottom spacers so native scrollbar geometry stays real. A per-kind height oracle (O(1) `raw` estimate, replaced by measured height cached by stable id) feeds a Fenwick index↔offset model; a `revealPath` primitive scrolls off-window focus/caret/undo/selection targets into the window and awaits their mount before acting, with the focused block pinned mounted. Nested-containers 1MB keystroke p50 collapsed to flat-prose parity as mounted components dropped to viewport scale; a machine-independent mounted-count ceiling joins the commit gate.
- **Recursive container windowing** — extends into blockquote, list-item, and long-flat-list scopes (a `list` / `table` bypasses `BlockList` and windows its own `{#each}` children directly). One shared `createListWindowing` per scope composes the oracle + model + window; the absolute-index slice contract is single-sourced in `sliceWindow`. Measured heights propagate upward through two passive index-keyed channels (leaf and subtotal); `revealByPath` descends nested levels.
- **Table-row windowing** — a giant table windows its rows, reusing the shared wiring wholesale; the one new mechanic is grid geometry (row height read from a cell, spacers span the full grid width). Row→cell path descent also closes the cross-block-command-can't-reach-a-table-cell gap, and the pass fixed a chain of pre-existing table cross-block selection bugs (cross-block edit wiping a table body, collapse-to-start cell landing, last-block delete leaving one empty paragraph).
- **`useContainerWindowing` extraction** — the per-scope wiring boilerplate collapses into one hook so a future or plugin container kind inherits windowing by naming only its variation.
- **Pressure-test hardening** — width/resize invalidation, manual scroll-anchor correction (`overflow-anchor` disabled), the scope-owned batched read-all-then-write measure pass, bounded reveal, off-window pure-data vertical-transparency, per-scope width estimates, and sticky-column geometry from the first mounted row — backed by non-vacuous regression guards (layouts-per-mount bound, settled-scroll-position compensation).

Known limitations at the time: single-giant-container shapes windowed rendering but their 10MB _load_ stayed capped at 1MB in the harness (since un-capped in 0.8.5 — load is linear and the keystroke is O(viewport)). (The block-scoped-keydown focus drop and the column-width drift listed here were fixed in the later forge-review hardening pass.) Internal only.

### 0.8.0 — Latency attribution + first-edit re-render fix

Opens the 0.8 performance line. The profiling harness gains block-render and in-page keystroke instruments plus a prod-vs-dev capture project; the attribution (record: `docs/design/performance.md`) traces the nested-1MB keystroke cost (~375ms prod) to two sources — a dominant steady-state framework reactive-flush proportional to mounted components (ratifying virtual rendering (0.8.6) as the primary spine) and a one-time first-edit full-document re-render, fixed here: the `$state` link-reference resolver was reassigned a fresh identity on every edit, re-rendering every block that read it at mount; it now reassigns only on LRD-signature change, and the render path reads it only for bracket-bearing blocks. Guarded by `block-render-scoping.spec.ts`. Internal only.

### 0.7.12 — Module-readiness completion

Closes the Track B module-readiness line. `index.ts` is curated to exactly what an `<Editor>` consumer needs (the component + its props/resolve/policy types, `parse`/`serialize` and inline preprocessing, node/inline and event-payload types); internal plumbing leaks are pulled back (`LIST_CONTEXT_KEY`, the tree-op primitives, `createUndoManager`/`cloneDocument`/`assignIds`, `editor-keys.ts`) on the asymmetry that adding an export later is non-breaking but removing one is breaking. The four test/debug methods move behind `editor.__test`. Two consumer docs land: a module `README` and `docs/guide/consumer-guide.md`. `dev-warn.ts` decouples from the build toolchain via an injectable `env.ts` seam (`configureEditorEnv`). Per-file unit coverage closes the transitive-coverage gap for `cursor/sticky-measure.ts`, `cursor/visual-lines.ts`, and `devWarn`. No behavior change. Internal only.

### 0.7.11 — CSS ownership migration

The editor module owns its CSS. Two stylesheets ship under `src/lib/styles/`: `editor.css` (structural painting rules for imperatively-built DOM, auto-imported) and `editor-theme.css` (editor-owned token values, consumer-imported). Every painting rule is wrapped in `:where(.editor)` — full namespacing at zero added specificity. Editor-owned tokens (`--syntax-*`, `--code-tok-*`, `--font-editor`, promoted presentational tokens) are declared at `:root`; host tokens (`--color-*`, `--radius-*`) are only read-with-fallback so the host's `applyTheme()` keeps winning. Divergent fallbacks collapsed to one canonical value per host token; engineered zero-visible-change and verified pixel-identical in both palettes. New G4.6 source-scan guard keeps `app.css` clean. Internal only.

### 0.7.10 — Editor boundary-hardening

Three waves of boundary work, pre-staging the 0.8.3 freeze's error-reporting contract. Internal only.

- **Error boundary + commit rollback** — a new `error` channel on the editor's event surface (`EditorError`, `origin: subscriber | render | commit`); each block wrapped in a `<svelte:boundary>` so a render-throw degrades to a recoverable failed-block fallback with siblings intact; the commit ceremony captures both undo stacks before the push and restores them via `UndoManager.restoreStacks` on a throwing mutation (never publishing a partial tree).
- **URL / link policy + seam** — a pure scheme allowlist (`core/url-policy.ts`) enforced at the render sinks blocks `javascript:`/`vbscript:`/`file:` (and `data:` in `href`), defeating control-char obfuscation; a blocked scheme renders an inert `span.md-link-blocked`. Three consumer seams land with today's behavior as default: `resolveLinkUrl`, `imageLoadPolicy`, and `onLinkActivate` (replacing the hardcoded `window.open`).
- **Accessibility baseline + axe gate** — WCAG 2.1 AA declared as target; the editor root gains `role="group"` + `aria-label`; the AT-invisible cross-block selection is announced through a visually-hidden `aria-live` region fed by a pure `createSelectionDescription` builder. A new `e2e-a11y` project runs `@axe-core/playwright` over `.editor` and fails on any violation outside a committed, only-shrinking baseline allowlist (the milestone-tied log of deferred AA work).

### 0.7.9 — Command registry + per-kind keybinding declaration

Closes the Track B keybinding work. Per-block-kind keybindings become declarative — `BlockKindDescriptor.keymap` maps a normalized chord (`Mod` = Ctrl/Cmd) to a command id — dispatched through a command registry that replaces the scattered `onKeyDown` branches. The registry is a `schema/` leaf: `schema/commands.ts` single-sources the vocabulary and registers global commands as free functions, exposing `dispatchKeyCommand` (per-kind keymap → global fallthrough, for a focused leaf) and `resolveKindBinding` (kind-only, for container bubble handlers); `schema/keybindings.ts` owns chord parse/normalize. Block-local bodies run on the focused component via `BlockComponent.runCommand(id, arg?)`, which reads the caret live so cross-block dispatch operates at the collapsed position. The cross-block delete-then-redispatch hack retires (a source-scan guard forbids `new KeyboardEvent` in runtime source); new bootstrap invariant G1.11 (keymap coherence). One deliberate tightening: normalized chords match modifiers exactly, so modifier-augmented variants the old loose guards incidentally caught now fall through to native. Behavior-preserving against the full e2e + simulation; a double-undo regression (container bubble re-firing undo because a leaf's async handler `preventDefault`s only after an `await`) was caught by the gate and fixed by the kind-only container resolution.

### 0.7.8 — Schema seam

Three waves making the block-kind schema the single dispatch authority, scoped to 0.7's module-readiness. Behavior-preserving.

- **Op-vocabulary substrate** — `OperationDetailMap` (`schema/operations.ts`) derives `OperationKind`, `OpDescriptor`, and `EditEvent` so kind/detail drift is a compile error (retiring the widening casts). Plugin kinds become nameable via a branded `PluginBlockKind` (`declarePluginKind`, rejects built-in collisions); `CstNode.kind` deliberately stays `BlockKind` until the 0.8.3 freeze.
- **Declarative per-kind entry** — the parser's opener chain is registry-driven (kinds declare `{priority, tryOpen, interruptsParagraph}` in `schema/block-openers.ts`), and the paragraph-interrupt scan derives from the same declarations (new G1.10 guard). Container paste-merge is declarative (`BlockKindDescriptor.containerPaste`); the tableCell structural-paste special case moves to an `onScopedStructuralPaste` hook. Accepted, measured cost: registry dispatch adds ~8–16% to full-document parse on block-dense shapes (load-path only; keystroke re-parse unaffected).
- **UnwrapRole + declared rebuilders** — containers declare Backspace-unwrap behavior (`unwrapRole` names a first-child and middle-child strategy); `rebuildRaw` is declared at registration (bodies in `schema/container-rebuilders.ts`), retiring the post-augment patch-in. The G4.3 conformance kit holds container kinds to all three declaration families.

### 0.7.7 — Performance harness + inline-sweep scoping

The scale gate becomes measurable. A deterministic fixture corpus (six seeded shapes at any byte target, golden-pinned) feeds three layers: dev-mode perf instruments at five seams with a `__test.perf` bridge; a vitest bench suite (`perf:editor`) over parse, clone, and ancestry rebuild with a machine-stamped baseline; and a PERF-gated Playwright project (`perf:e2e`) recording fixture load and per-keystroke p50/p95. Machine-independent counter ceilings join the commit gate (`test:editor:perf`). Riding the harness: ten dead resolver-less `parseAllInlineContent` calls deleted, and the per-edit inline sweep scoped to a dirty-set (one top-level subtree on the typing path; whole-doc only on LRD-signature change or structural ops). Honest attribution recorded in the baselines — the sweep was not the dominant per-keystroke cost. A real bug surfaced: a typing batch displaced within the debounce window dropped its `input` event, leaving the previous block's inline cache resolver-less; displaced batches now flush on key change. `parseBlocks(lines, start, end)` is named a stable seam for range re-parse.

### 0.7.6 — Block-edit ladder + decomposition (Track A close)

Three waves closing Track A's architectural-hardening line. Behavior-preserving (full e2e + simulation unchanged).

- **Decomposition wave 1** — the keystroke debounce/batch state machine extracted into a named text-batch lifecycle (`editor-actions/text-batch.ts`); one owned `ContainerScope` shape across container/multi-scope/paste commits; `commitMultiScope` restructured onto `prepareScopeView`/`publishScopeView`; the `skipSnapshot` boolean replaced by an `undoEntry: 'own' | 'join'` option. Pure cores extracted with direct unit tests (`cellKeydownPlan`, `core/inline/ranges.ts`, `consumeStickyLanding`, `replacePreservingFirst`, and others), plus image-overlay orchestration out of `Editor.svelte` into `ImageOverlayHost`.
- **Decomposition wave 2** — by-convention couplings single-sourced, plus two logged defects closed (the IME-composition cross-block delete converged onto the commit primitive; `cascadeCleanupEmptyAncestors` no longer drifts a surviving ancestor's `childIds`). New seams: `pushChild`/`spliceChildren` lockstep helpers (`tree-operations/children.ts`), `updateNodeContent` speaking the `StructuralChange` return language, table column mutators returning per-row `StructuralChange`s, and the terminate-and-splice list-item weld.
- **Block-edit ladder core** — the top-level and container `BlockEditActions` factories stop duplicating their structural-edit bodies: a `CommitScope` adapter captures every per-level difference and `createBlockEditCore` writes split / merge / delete / replaceBlock / metadata once against it; the paste preDelete-fold single-sources into `foldPasteReplacement`. `insertParsedBlocks` and `updateBlockContent` stay per-factory by necessity (the dual-emit paste event, and the divergent load-bearing kind-change undo-batching — unification attempted and reverted). Closes Track A.

### 0.7.5 — Property/fuzz-test the invariants

Generator-based (fast-check) coverage over the load-bearing invariants: round-trip/parser-totality over arbitrary and malformed input, EOF edge states, inline-conformance corpus, the `textContent === ambientPrefix + raw` spine, inline-offset partition, serialization purity, selection partition, split/merge id↔ref↔children alignment, and the paste op-kind dual-emit. Reactivity and timing rules become source-scan guards; a registry-derived conformance kit holds any container kind to the per-container invariants. New `test:editor:invariants` area under `test/invariants/`.

### 0.7.4 — Structural-sharing undo

Undo checkpoints stop deep-cloning the document. The container-raw decision (`docs/design/performance.md`) keeps materialized container raw and spends the work on the undo axis, where the cliffs were. Snapshots now share the live tree's nodes, marked by an editor-level sharing epoch (`ownerEpoch`, `undo/sharing.ts`); a push costs O(top-level children) — ~1000× down — and per-snapshot heap drops to KB-scale spine divergence. The cost moves to mutation discipline: copy-path-on-write everywhere (`tree-operations/unshare.ts`), with the commit primitives owning the protocol. Aliasing is guarded three ways: invariant G1.9 (no mutation writes serialized bytes through a snapshot-shared node) with negative fixtures; a DEV integrity oracle digesting and re-verifying each snapshot at every commit and restore; and a keystone fast-check property driving random op sequences through the real action factories. The multi-seed simulation joined the default battery after the oracle caught a real Svelte 5 proxy bug; the fix — write the copy into the `$state` tree, then re-read it through the tree before further use — is now the canonical-reference discipline in the unshare contract.

### 0.7.3 — Spec/doc accuracy

Design-doc reconciliation surfaced by the architecture review: documented the table/grid exemption from the container-internal invariant, `unrecognized` as a reserved kind, the container-strip inline coordinate spaces, the commit-ceremony-vs-event-seam distinction, and the state-registry WeakMap-GC reality; unified (or justified) the scroll-ancestors divergence. Added the `docs/design/invariants.md` catalog.

### 0.7.2 — Node-model & schema guardrails

Convention-enforced invariants become compile-time and runtime-checked. Compile-time: typed `metadataOf`/`BlockMetadataByKind` (retires ~68 metadata `as`-casts), `defineBlockComponent`, union-derived `BLOCK_KIND_TABLE`, a `containerContract: 'strip' | 'grid'` descriptor field, branded `CURSOR_END`/`SELECTION_END` sentinels, and a cell-coordinate discriminant on `SelectionPoint`. Runtime: a dev-only, non-crashing `assertInvariant` channel wiring DEV checks (G1.1–G1.8) at the commit primitive, bootstrap, `cloneNode`, and the nested-actions helper; BlockHost renders a visible raw block for a kind with no registered component. Drove the svelte-check baseline from 21 errors / 18 warnings to 0 / 11.

### 0.7.1 — selection→table DAG inversion + issue-log sweep

Closes the `selection/ → components/` dependency inversion: the table foreign-drag hit-test moves behind an optional `foreignDragHitTest` descriptor hook registered from the top-of-DAG wire-up, so `drag-pointer.ts` dispatches by `data-block-kind` through the descriptor registry. Bundles the editor issue-log sweep: reference blocks re-render when an LRD changes elsewhere (render memo keys on the LRD signature, gated to reference-bearing blocks); blockquote-into-blockquote paste no longer destroys the target paragraph; type/paste across two top-level tables no longer corrupts the grid raw (carets are char-addressable deep paths with identity-resolved survivor paths); table cells now render inline content through the same pipeline as prose via a `cell-render.ts` factory, with widget-aware cell offset reads and cursor I/O.

### 0.6 — Complete GFM Coverage

Every GFM construct parses, renders, and edits (shipped as 0.6.1–0.6.7.1; per-patch narratives in git log). Task list items gained click-to-toggle checkboxes on a new `AmbientPrefix` interactive-range contract, with a source-preserving `taskMarker` metadata field. CommonMark §6.1/§6.2 pre-passes added backslash escapes and HTML character references. Tables became per-cell editable containers (Tab/arrow/Enter navigation, rectangular selection, row/column ops, alignment cycle, three-stage Ctrl+A, pipe-aware paste) and moved per-container ids onto `node.childIds`. Images render as atomic inline widgets (`contenteditable="false"`, dimension hints, drag/Shift+Arrow resize, a `resolveImageUrl` hook). Autolinks closed the GFM §6.9 gaps. Reference-style links and images resolve in all three forms with document-level resolver reactivity. HTML blocks meet §4.6 per-type close conditions and the paragraph-interrupt rule; inline raw HTML (§6.10) parses with allowlisted tags as atomic widgets. The paste-into-list family converged on one rule — absorb on matching list type, break out on mismatch, newline-terminated splices, pre-splice marker computation — and Enter on an empty nested item outdents one level. An eight-pass decomposition sweep (0.6.1.x) cleaned the layer DAG and retired shelf-named directories before the feature work resumed.

### 0.5 — Forge-Review Hardening + Pre-Coverage Seams

The full forge-review audit became the v0.6 baseline, worked off in five tiers (per-patch narratives in git log). Structural spine: every structural mutation unified on the `__commit` primitive with the `editor.events` seam (`edit` + `selectionChange`), multi-scope commits for cross-container mutations, `StructuralChange` descriptors auto-syncing ids/refs, a metadata-only commit path, and the `BlockListState` registry closing children-mutation bypass sites. One paste dispatcher replaced five paste sites, pinned by a clipboard regression suite. The debug engine and `/test/editor` panel gave investigations a structured CST/selection/undo/ops view. The list marker moved inside the contenteditable as the ambient-prefix contract (unblocking task checkboxes), `SELECTION_END` and the sticky-column two-axis contract were pinned before tables, and module-DAG consolidations made `BlockKindDescriptor` the single dispatch authority. Correctness sweeps fixed cross-block typing event emission, id preservation through IME, ambient-aware measurement, multi-line link reference definitions, and CRLF hard-break matching.

### 0.4 — Cross-Block Selection & Clipboard

Cross-block selection, overlay rendering, keyboard/pointer extension, and clipboard operations spanning multiple blocks. Path-based addressing (`path: number[]`) replaces flat block indices throughout selection and undo layers; lazy `SelectionState` (null in single-block mode) with cross-container "start wins" semantics; `SelectionOverlay` mounted at `BlockHost`; Shift+Arrow / Ctrl+Shift+Home/End / double Ctrl+A keyboard extension; rAF-throttled pointer drag with autoscroll; cross-block Copy/Cut/Paste/Delete/Backspace/type-replace; undo restores cross-block selection state. Follow-up patches (0.4.1–0.4.3): the organizational pass, paste correctness + code-block Enter through the CST + list-exit content preservation, and the pre-v0.5 sweep.

### Pre-0.4 history

Compact summary; see git log for the full record.

- **0.3.5** — Code-block rewrite: `<textarea>` → `contenteditable` with live highlight.js syntax (17 bundled languages via plugin-shaped registry), sticky-column participation (retires the "opaque block" category), Tab / Shift+Tab indent, ArrowLeft / ArrowRight boundary navigation, paste fence-length bump.
- **0.3.4** — Architecture refactor (no user-visible change). `EditorActions` god interface split into four concern-specific sub-interfaces; container-state primitive layer extracted; `tree-operations.ts` and `parser.ts` split per-kind into directories; `inline-parser.ts` split by pipeline stage; cursor/visual-line helpers extracted to `text-surface/`.
- **0.3.3** — List/blockquote unwrap rules (U1/U2/M1), cross-container Backspace merge, MergeRole role refactor (replaced `MERGEABLE_PAIRS` set), pixel-X sticky column foundation. Fixed `isItemEmpty` data-loss bug + blockquote stuck-caret traversal.
- **0.3.2** — Foundations: geometry-based focus traversal, recursive list parsing (nested sub-lists, continuation lines, multi-paragraph items), multi-block paste, forward delete, Tab/Shift+Tab list indent, Ctrl+B/I inline formatting. Fixed `bind:ref` ref-array drift after structural ops.
- **0.3.1** — Container raw propagation for nested edits (lists + blockquotes); list-item marker round-trip preservation.
- **0.3** — Inline parsing: backtick spans, delimiter-run emphasis/strong/strikethrough, links/images/autolinks, hard line breaks. Inline renderer with dimmed marker spans, cursor save/restore through the span tree, per-input re-render. Markers extracted via `raw.slice()`, never reconstructed.
- **0.2** — Block editing: editor shell with CST ownership, full component hierarchy (Text/Code/ThematicBreak/Blockquote/List/ListItem), tree ops (split/merge/delete/updateContent), merge eligibility rules, container raw reconstruction, undo/redo with snapshot-based CST cloning + debounced batching, parallel ID array for stable keyed rendering, list Enter behavior. Fixed container ID desync on undo/redo, double chars, cursor loss in leaf↔container transitions.
- **0.1** — CST foundation: single-pass line-oriented GFM block parser producing mutable `CstNode` tree, all block types with recursive container parsing, metadata extraction (heading level, fence markers, list markers, task items, etc.), lossless `serialize(parse(source)) === source` round-trip, `leadingTrivia` / `prefix` / `suffix` whitespace fidelity.
