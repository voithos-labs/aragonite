# Code Style

## What this is

The general conventions: naming, structure, comments. Nothing exotic, and nothing you have not seen before. Most decent codebases converge on roughly this list, and it is written down here so nobody has to guess which dialect of it we speak.

The rules specific to _this_ codebase, the ones that will actually eat somebody's file if you get them wrong, live in `docs/contributing/rules.md`. Read that one before your first edit. This one you can absorb as you go, and you have probably absorbed most of it already.

**The cardinal rule: when you touch messy code, improve what you touch.** Do not conform to bad patterns already in the file. Renaming a local, adding a section divider, pruning a stale comment: that is part of the edit, not a separate chore you file for later and never do.

## Naming

Name by role or purpose, not implementation (`userRecords`, not `hashMap`). Booleans read as questions (`isVisible`, `hasChildren`). Functions name their action or return value (`fetchUser`, `parseConfig`). Avoid generic names (`data`, `item`, `temp`) outside a handful of lines. And stay consistent: if it is `user` here, it is not `account` there. Half the confusion in any codebase is two names for one thing.

## Simplicity

No abstraction until the third repetition. Abstraction is a cost, and you pay it when repetition forces your hand, not when you get a feeling. Prefer flat control flow. Delete dead code, git remembers. If a function needs a paragraph to explain what it does, it is doing too much, so split it.

## Decomposition

Each function, file, and module has one responsibility you can state in a short sentence. If you need an "and" to describe it, split it. Prefer composable functions over one long function steered by a mode flag.

A block's `.svelte` file is a **composition root**: it wires state, lifecycle, and the extracted per-concern modules beside it, and that wiring is its one responsibility, so line count alone never forces a split. A long file here is not automatically a sick one. What does force a split: any new logic block that doesn't touch lifecycle or need the whole component's state lands as a `createX(deps)` factory in a sibling `.ts` module (reactive reads passed as getters), never inline. The table and text block folders are the pattern to copy.

## File structure

Section dividers mark logical groupings:

```
// ── Section name ────────────────────────
```

Public API near the top, internals below. Colocate types with the code that uses them, and reach for a separate `types` file only when the type is genuinely shared.

A complex file reads top to bottom, newspaper order. The first screen states its one
responsibility (a header only when the filename doesn't already say it). The main operation comes
before its sub-steps, so a reader meets `parse()` before `parseNextBlock()`. Each section holds
only what its name says, ordered by reader priority rather than by accretion history. State sits
near the effects that use it, and a single-caller helper sits within a screen of its caller. The
test: a maintainer can answer "what does this file do, and where would I change X?" from headers,
section names, and signatures alone. If they have to read the bodies to find out, the file is not
organized, it is sorted by the order you happened to write things in.

## Comments

Default to none. Explain **why** (the non-obvious choice, the workaround, the deliberate exclusion) and never **what**, since names and types already carry the _what_. Budget: a comment is 1-2 lines, and a file or contract header is at most ~5. A why that needs more room moves to a design doc, with a one-line pointer left behind. The test: if removing the comment wouldn't confuse a reader, delete it. And you own a file's signal-to-noise the moment you touch it, so prune the failing ones even when you didn't write them. Especially when you didn't write them.

Delete on sight:

- Enumerating a union's or enum's members in prose. The moment someone adds a variant the comment starts lying, and nobody notices for a year.
- Version or date references (`post-0.5.4`, `as of 2024`): ephemeral context, frozen into the file forever.
- Narrating the next line (`// now set the flag`), or restating a name in prose. No information beyond the code.
- Naming callers or the current task (`used by the X flow`, `added for #123`). That belongs in the commit or the issue tracker.
- Multi-paragraph docstrings on internal functions. The name and the signature carry the load.
- Design-rationale essays (incidents, rejected alternatives, review history). That context lives in git log, issues, and `docs/`; the code keeps one line of why, at most.

## Directories

A directory reflects a decision, not an accident. Name the concept that lives there (`parser/`, `selection/`, `undo/`), never the role (`utils/`, `helpers/`, `managers/`). Anything ending in `-ers` is usually a shelf rather than a boundary, and a shelf is where code goes when its author did not know where else to put it. What changes together lives together, and directories form a DAG, with volatile code depending on stable, never the reverse.

## Formatting

Prettier owns every formatting decision, so there is nothing here to argue about. That is the entire point of handing it over. Tabs, single quotes, 100 columns, see `.prettierrc`.

One exception is configured rather than argued: a Markdown code fence is quoted syntax, not code, so embedded formatting is off for `*.md`. A fence showing `~single tilde~` keeps the bytes it demonstrates instead of being helpfully rewritten into the exact form the demonstration is contrasting against.

```bash
npm run format   # write
npm run lint     # check (this one is in the commit gate)
```

`npm run lint` runs four arms in order: the Prettier check above, the docs-pack link gate (`scripts/build-docs-pack.mjs`), the codebase-map reference gate (`scripts/check-codebase-map.mjs`), then ESLint. A failure names its own arm, so read the first one that fires instead of assuming it was formatting. It usually isn't.
