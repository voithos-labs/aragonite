# Code Style

## What this is

The general conventions — naming, structure, comments. They're not exotic; they're the ones most good codebases converge on, written down so nobody has to guess.

The rules specific to _this_ codebase — the ones that will actually corrupt a document if you get them wrong — are in `docs/contributing/rules.md`. Read that one before your first edit. This one you can absorb as you go.

**The cardinal rule: when you touch messy code, improve what you touch.** Don't conform to bad patterns already in the file. Renaming a local, adding a section divider, pruning a stale comment — that's part of the edit, not a separate chore.

## Naming

Name by role or purpose, not implementation (`userRecords`, not `hashMap`). Booleans read as questions (`isVisible`, `hasChildren`). Functions name their action or return value (`fetchUser`, `parseConfig`). Avoid generic names (`data`, `item`, `temp`) outside a handful of lines. Stay consistent — if it's `user` here, it isn't `account` there.

## Simplicity

No abstraction until the third repetition — abstraction is a cost, paid only when repetition forces it. Prefer flat control flow. Delete dead code; git remembers. If a function needs a paragraph to explain what it does, it's doing too much — split it.

## Decomposition

Each function, file, and module has one responsibility you can state in a short sentence. If you'd use "and" to describe it, split it. Prefer composable functions over one long function steered by a mode flag.

A block's `.svelte` file is a **composition root**: it wires state, lifecycle, and the extracted per-concern modules beside it, and that wiring is its one responsibility — line count alone never forces a split. What does force one: any new logic block that doesn't touch lifecycle or need the whole component's state lands as a `createX(deps)` factory in a sibling `.ts` module (reactive reads passed as getters), never inline. The table and text block folders are the pattern.

## File structure

Section dividers mark logical groupings:

```
// ── Section name ────────────────────────
```

Public API near the top, internals below. Colocate types with the code that uses them — a separate `types` file only when the type is shared.

A complex file reads top to bottom, newspaper order: the first screen states its one
responsibility (a header only when the filename doesn't already say it); the main operation
comes before its sub-steps — a reader meets `parse()` before `parseNextBlock()`; each section
holds only what its name says, ordered by reader priority, not accretion history; state sits
near the effects that use it, and a single-caller helper within a screen of its caller. The
test: a maintainer can answer "what does this file do, and where would I change X?" from
headers, section names, and signatures alone.

## Comments

Default to none. Explain **why** — the non-obvious choice, the workaround, the deliberate exclusion — never **what**; names and types carry the _what_. Budget: a comment is 1-2 lines, and a file or contract header is at most ~5. A why that needs more moves to a design doc, with a one-line pointer left behind. The test: if removing the comment wouldn't confuse a reader, delete it. You own a file's signal-to-noise when you touch it — prune failing comments even when you didn't write them.

Delete on sight:

- Enumerating a union's or enum's members in prose — the moment someone adds a variant, the comment lies.
- Version or date references (`post-0.5.4`, `as of 2024`) — ephemeral context frozen into the file.
- Narrating the next line (`// now set the flag`) or restating a name in prose — no information beyond the code.
- Naming callers or the current task (`used by the X flow`, `added for #123`) — belongs in the commit or issue tracker.
- Multi-paragraph docstrings on internal functions — the name and signature carry the load.
- Design-rationale essays (incidents, rejected alternatives, review history): that context lives in git log, issues, and `docs/`; the code keeps one line of why at most.

## Directories

A directory reflects a decision, not an accident. Name the concept that lives there (`parser/`, `selection/`, `undo/`), never the role (`utils/`, `helpers/`, `managers/`) — anything ending in `-ers` is usually a shelf, not a boundary. What changes together lives together; directories form a DAG, with volatile code depending on stable, never the reverse.

## Formatting

Prettier owns every formatting decision, so there is nothing to argue about. Tabs, single quotes, 100 columns — see `.prettierrc`.

```bash
npm run format   # write
npm run lint     # check (this one is in the commit gate)
```

`npm run lint` runs three arms in order: the Prettier check above, the docs-pack link gate (`docs/README.md`), then ESLint. A failure names its own arm, so read the first one that fires rather than assuming formatting.
