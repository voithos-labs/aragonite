# Code Style

How we name, shape, comment, and format code. Nothing exotic; most decent codebases converge on roughly this list, and it's written down so you don't have to guess which dialect of it we speak. You can absorb this page as you go; you've probably absorbed most of it already.

There's one rule that outranks the rest of the page: **when you touch messy code, improve what you touch.** Don't conform to bad patterns already in the file. Renaming a bad local, adding a section divider, pruning a stale comment are part of the edit, not a chore you file for later and never do.

## Naming

Name by role, not implementation: `userRecords`, not `hashMap`. Booleans read as questions (`isVisible`, `hasChildren`); functions name their action or their return value (`fetchUser`, `parseConfig`). Generic names (`data`, `item`, `temp`) get a lifespan of a handful of lines, no more. And stay consistent: if it's `user` here, it's not `account` there. Half the confusion I've seen in any codebase is two names for one thing.

## One job per piece

Every function, file, and module does one thing you can state in a short sentence. If the sentence needs an "and", split. If a function needs a paragraph to explain what it does, it's doing too much, split that too. And a long function steered by a mode flag would rather be two composable functions.

A few adjacent habits:

- No abstraction until the third repetition. Abstraction is a cost; pay it when repetition forces your hand, not when you get a feeling.
- Prefer flat control flow.
- Delete dead code. Git remembers.

Now, the one place this rule looks broken on purpose: block components. The editor renders a document as blocks (a paragraph, a table, a code fence, each kind its own Svelte component), and a block's `.svelte` file is a **composition root**: its one job is wiring together state, lifecycle, and the per-concern modules sitting beside it. Wiring is a single responsibility no matter how many wires, so line count alone never forces a split there. A split is forced when new logic arrives that neither touches lifecycle nor needs the whole component's state. That logic never goes inline: it becomes a `createX(deps)` factory in a sibling `.ts` module. Hand the factory its reactive values as getters (`() => value`, not `value`), so it always reads the live value instead of a snapshot from mount time. The table and text block folders (`src/lib/components/blocks/table`, `src/lib/components/blocks/text`) are the pattern to copy.

## Inside a file

A complex file reads top to bottom in newspaper order: the point first, the details after. In practice:

- The first screen states the file's one responsibility, with a header comment only when the filename doesn't already say it.
- Public API near the top, internals below, and the main operation before its sub-steps, so a reader meets `parse()` before `parseNextBlock()`.
- Section dividers mark the logical groupings:

  ```
  // ── Section name ────────────────────────
  ```

  and each section holds only what its name says, ordered by what a reader wants first, not by when things got written.

- State sits near the effects that use it, and a helper with a single caller sits within a screen of that caller.
- Types live next to the code that uses them; a separate `types` file exists only when a type is genuinely shared.

The test for all of it: a maintainer can answer "what does this file do, and where would I change X?" from headers, section names, and signatures alone. If they have to read the bodies to find out, the file isn't organized, it's sorted by the order you happened to write things in.

## Comments

Default to none. The one you do write explains **why** (the non-obvious choice, the workaround, the deliberate exclusion), never **what**; names and types already carry the what. The budget: a comment is 1-2 lines, and a header (the comment at the top of a file, or the one stating a module's contract) is at most ~5. A why that needs more room moves to a design doc, with a one-line pointer left behind.

The budget has teeth, too. A source scan in the unit suite (G4.26 in `docs/design/invariants.md`) fails any comment block over six text lines, or a file header over seven; the slack above the stated budget is for contract prose that needs it. Here's the red line, from a seven-line comment I planted for the occasion:

```
$ npx vitest run src/lib/test/invariants/lint/comment-budget.test.ts
 FAIL  src/lib/test/invariants/lint/comment-budget.test.ts > G4.26 comment blocks stay inside the budget > no comment block under src/lib or src/routes runs past its limit
AssertionError: expected [ { …(4) } ] to deeply equal []
+ [
+   {
+     "limit": 6,
+     "line": 4,
+     "relPath": "src/lib/zz-probe-comment.ts",
+     "textLines": 7,
+   },
+ ]
```

For the comments already in a file: if removing one wouldn't confuse a reader, delete it. You own a file's signal-to-noise the moment you touch it, so prune the failing ones even when you didn't write them. Especially when you didn't write them.

Delete on sight:

- Enumerating a union's or enum's members in prose. The moment someone adds a variant the comment starts lying, and nobody notices for a year.
- Version or date references (`post-0.5.4`, `as of 2024`): ephemeral context, frozen into the file forever.
- Narrating the next line (`// now set the flag`), or restating a name in prose. No information beyond the code.
- Naming callers or the current task (`used by the X flow`, `added for #123`). That belongs in the commit or the issue.
- Multi-paragraph docstrings on internal functions. The name and the signature carry the load.
- Design-rationale essays (incidents, rejected alternatives, review history). That context lives in git log, issues, and `docs/`; the code keeps one line of why, at most.

## Directories

A directory reflects a decision, not an accident. Name the concept that lives there (`parser/`, `selection/`, `undo/`), never the role (`utils/`, `helpers/`, `managers/`). Anything ending in `-ers` is usually a shelf rather than a boundary, and a shelf is where code goes when its author didn't know where else to put it. Beyond the names: what changes together lives together, and directory dependencies form a DAG (arrows flow one way, no cycles), with volatile code depending on stable code and never the reverse.

## Formatting

Prettier owns every formatting decision, so there's nothing to argue about here. Tabs, single quotes, 100 columns: `.prettierrc` has the full config.

One exception, configured rather than argued: inside a Markdown file, a code fence is quoted syntax, not code, so Prettier's embedded formatting is off for `*.md`. Otherwise a fence demonstrating `~single tilde~` would get helpfully rewritten into the exact spelling the demonstration is contrasting against.

```bash
npm run format   # write
npm run lint     # check
```

`npm run lint` sits in the commit gate (the checks that must be green before a commit), and it's actually four checks in a row:

1. the Prettier check
2. the docs-pack link gate (`scripts/build-docs-pack.mjs`): every relative link in the docs points at a file that exists, and links in the published guide may not leave it
3. the codebase-map reference gate (`scripts/check-codebase-map.mjs`): every `src/`, `docs/`, or `scripts/` path a design or contributing doc names in backticks must still exist on disk
4. ESLint

A failure says which of the four fired, so read that instead of assuming it was formatting. It usually isn't. One of each, provoked on purpose so you know the shape:

```
$ npx prettier --check src/lib/zz-probe.ts
Checking formatting...
[warn] src/lib/zz-probe.ts
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
```

```
$ node scripts/build-docs-pack.mjs
docs-pack: dead pointers (every target must name a file the pack ships):
  directives.md: nowhere.md
```

```
$ node scripts/check-codebase-map.mjs
codebase-map: unresolved references in docs/design, docs/contributing:
  docs/contributing/warnings.md: src/lib/nope.ts …
```

(that last line goes on to say `no such file or directory`)

```
$ npx eslint src/lib/zz-probe.ts
  1:8   error  'probe' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  2:43  error  'dead' is assigned a value but never used. Allowed unused vars must match /^_/u   @typescript-eslint/no-unused-vars

✖ 2 problems (2 errors, 0 warnings)
```
