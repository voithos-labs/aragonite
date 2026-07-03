# CLAUDE.md

## What this is

aragonite is a **CST-based block editor for GFM Markdown** — SvelteKit + TypeScript, shipped as an embeddable library. Raw Markdown is the single source of truth: parsed into a lossless concrete syntax tree, rendered as styled blocks with dimmed markers, round-tripped byte-for-byte. The library is `src/lib/`; `src/routes/test/editor` is a demo/dev harness. Extracted from the limestone app, which is its first downstream consumer.

### Architecture

```
Raw Markdown
      │  parse
      ▼
  CST (mutable plain objects)  ── single source of truth
      │  render
      ▼
  Contenteditable DOM (styled inline spans)
      │  serialize
      ▼
  Raw Markdown
```

**Key invariant:** `serialize(parse(source)) === source` for all valid GFM.

```
Editor (owns CST, undo stack, editor-actions contexts)
  └─ BlockList (keyed loop over CST children, windowed)
       └─ BlockHost (dispatches by block kind)
            ├─ TextEditableBlock / CodeBlock / ThematicBreakBlock
            ├─ BlockquoteBlock (recursive) / ListBlock → ListItemBlock (recursive)
            └─ TableBlock (per-cell editable grid)
```

### Module layout (`src/lib/`)

```
components/      block components (Editor, BlockList, BlockHost, per-kind blocks)
editor-actions/  upward action bundles (split, merge, paste, container overrides)
tree-operations/ pure CST mutations (paste, list, blockquote, primitives) + the structural-sharing primitive (sharing.ts)
schema/          cross-cutting block-kind metadata (descriptors, registries, openers, merge rules, commands + keybindings)
core/            parser, serializer, inline pipeline, CST node types
ambient/         marker DOM + offset translation
cursor/          sticky column, visual lines, range measurement
reactivity/      block-list state and state registry
selection/       cross-block selection model and dispatch
undo/            undo stack + snapshot manager
invariants/      pure predicates guarding load-bearing contracts (dev assertions + tests)
perf/            dev-mode performance instruments
debug/           dev debug engine (CST/selection/undo/ops dumps)
search/          read-only find/replace lens over the CST
test/  e2e/      Vitest unit suites + Playwright E2E (+ requirements/)
styles/          editor.css (structural) + editor-theme.css (tokens)
index.ts         public barrel — the supported API surface
```

`schema/` is the only layer both `core/inline/` and `tree-operations/` may read from; it depends on neither. `invariants/` is a leaf.

### Design rules

1. CST is the single source of truth — if CST and DOM disagree, CST wins.
2. Only `await tick()` for timing — no setTimeout/rAF for sequencing.
3. All dependencies explicit — context, props, params. No runtime patching.
4. New block type = one component + one BlockHost entry + one block-kind descriptor entry.
5. Node copies are written into the `$state` tree, then re-read through it before further use — never hold a raw copy after the proxy has observed it (`tree-operations/unshare.ts` header).

### Debugging

Before hand-tracing editor state (CST, selection, undo stack, ops log), dump it. See `docs/testing.md` § "Using the debug engine inside tests".

## Commands

| Command                      | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `npm run dev`                | Demo app at `/test/editor`                |
| `npm run test:editor`        | Unit tests (all)                          |
| `npm run test:editor:<area>` | Unit tests by category (see package.json) |
| `npm run test:e2e`           | E2E tests (all)                           |
| `npm run test:e2e:<area>`    | E2E tests by category                     |
| `npm test`                   | Full suite — run before committing        |
| `npm run check`              | svelte-check (0 errors baseline)          |
| `npm run lint`               | Prettier check                            |

## Docs

Orient from `docs/design/editor/editor.md`. Read a design doc only when the task touches its subsystem.

| Document                                  | Scope                                             |
| ----------------------------------------- | ------------------------------------------------- |
| `docs/design/editor/editor.md`            | Editor design spec                                |
| `docs/design/editor/syntax-tree.md`       | CST node model, parser design, GFM block coverage |
| `docs/design/editor/inline-parsing.md`    | Inline parser pipeline, ambient prefix, rendering |
| `docs/design/editor/invariants.md`        | Load-bearing invariants catalog + enforcement     |
| `docs/design/editor/virtual-rendering.md` | Windowing for large docs                          |
| `docs/design/editor/plugin-contract.md`   | Frozen plugin-API contract (foundation)           |
| `docs/editor/consumer-guide.md`           | Embedding the editor: API, theming, props, events |
| `docs/editor/adding-a-block.md`           | How to add a new block type                       |
| `docs/editor/gfm-reference.md`            | GFM syntax reference                              |
| `docs/testing.md`                         | Test infrastructure and patterns                  |
| `docs/perf/performance.md`                | Perf claims, gate, and key decisions              |
| `docs/roadmap.md` / `docs/changelog.md`   | Forward plan / shipped history                    |

## Conventions

### Commit messages

Symbol prefix: `+` feature · `-` removal · `~` small tweak · `>` normal-to-large change · `!` bug fix · `@` docs/config. Lowercase, no trailing period, scope in parens when useful (`+ (editor) block parser`). Bundle edits into medium-sized commits, not micro-commits. Multi-line for multiple changes. **No `Co-Authored-By` line; no "Generated with" attribution.**

### Comments

Default to none. Explain _why_ (non-obvious choices), never _what_. If removing the comment wouldn't confuse a reader, delete it. When you touch a file, you own its comment signal-to-noise.

### Quality gate

Commit gate: `npm test` (full unit + every e2e project, incl. simulation) + `npm run check` (0 errors) + `npm run lint`. Area scripts are the inner loop only. Before merge/ship, also run the perf ceilings (`npm run test:editor:perf`).

### Testing

Tests must catch regressions. Ask: "if someone broke this, would this test catch it?" Fix bugs test-first where you can, so each fix lands as a permanent regression guard.

### Style / review

Follow the forge-\* conventions (style, docs, tests, review) where the toolchain provides them. Root-cause bugs before fixing — invoke systematic-debugging, fix the underlying class of problem, never patch around a bug or edge case with a one-off hack. After a major change, run a review pass.

### Subagents

Any dispatched subagent (via the `Agent` tool) must invoke the `forge-style`, `forge-docs`, and `forge-tests` skills at the start of its task and enforce them in every file it touches — including improving pre-existing verbose comments that fall in its path. Subagent briefs must name these three skills explicitly.

**Run dispatched subagents on opus 4.8 or fable 5.** For complex tasks, use fable 5, for simpler tasks, use opus 4.8.

**The controller (dispatching session) owns long-running processes** — the full e2e batteries, the perf gate, and the simulation suite. A subagent dies on a multi-minute stream-idle timeout whether it is parked on a background run or grinding a long active dispatch, so keep each dispatch bounded and run the long gates from the controller.

Reviewer subagents re-run every gate themselves — implementer-claimed numbers are never accepted. Batch similar, right-sized tasks (same subsystem/files, one cohesive change) into a single bounded dispatch rather than paying the context-rebuild + review tax per task; don't merge unrelated concerns just to save a dispatch.

Brief templates, the two-stage review contract, and the gate/process rules live in `.claude/skills/aragonite-dispatch`.
