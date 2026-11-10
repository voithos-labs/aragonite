# Code style

Read this when you're about to write a comment, add a module or reorganize a file. It holds only the style rules a gate or a reviewer will hold you to. How you name a loop variable stays between you and your conscience.

## Improve what you touch

Editing messy code means leaving it better. A bad pattern that's already there is no reason to repeat it. A big cleanup (a rename with many call sites, a file split) gets a commit of its own.

## Comments

Default to none. The reader is competent, new to the repo today, and reading once. There are three kinds, each with a line budget:

- **File header**, the file's first comment, with only imports above it: introduces the file to someone opening it cold. Free-form, up to 20 lines.
- **Contract docblock**, on an exported interface or type, or on an export (members included) of a published entry file (`index.ts`, `plugin.ts`, `svelte.ts`, `testing.ts`, `editor-props.ts`, `block-component.ts` in `src/lib/`): the purpose, plus at most one thing a caller must get right. Up to 5 lines.
- **Body comment**: why a line is the way it is, in one sentence. 1 or 2 lines, like ``// A depth, not a boolean: a commit started from an `edit` handler must not end the outer one.`` above `let depth = 0;`.

`src/lib/test/invariants/lint/comment-budget.test.ts` enforces the budgets. `comment-house-words.test.ts`, beside it, enforces the banned words, in comments and in the design and contributing docs, where a doc's allowance can only go down. Its `HOUSE_WORDS` table names each banned word and the phrase to write instead. Whatever the kind:

- No comment describes what the code does or how, argues against the alternatives, or keeps history: no union or enum members, versions, dates, issue numbers, callers, former behavior or rejected designs (a regression test may name its issue). A why that needs more room becomes a pointer to a design doc section.
- Everyday English. Name the subject (the parser, the undo stack), never "this" or "the layer". A private word that a symbol's name forces on you gets a gloss of three words or fewer.
- A catalog number like `G1.28` explains nothing, so state the fact. No capitals for emphasis.
- Would a reader be confused without the comment? If not, delete it. Editing a file makes its comments yours, inherited ones included.

## Organizing a file

Files are being reorganized one at a time, and `src/lib/browser/offsets.ts` went first, so read it and do the same. Group the code by feature, with each helper next to the export that uses it. Mark the groups with dividers 80 columns wide. A feature in a big file gets the three-line form the model file uses, and a sub-topic gets one line:

```ts
/* ---------------------------------- Name ---------------------------------- */
```

A reorganization is a commit of its own and changes no line of code. Many files still carry the outgoing `// ── Name ──` banners, and lose them when their turn comes.

## Components are wiring

A block's `.svelte` file connects state, lifecycle and its sibling modules. That is one job at any length, so size alone never forces a split. Logic that needs neither the lifecycle nor the whole component's state moves out, into a `createX(deps)` factory in a sibling `.ts` file that takes reactive values as getters; the table and text folders under `src/lib/components/blocks/` show the pattern. Extract a second copy of some code when both copies enforce the same rule; leave it when they merely look alike.

## Directories

A directory is named for a concept (`selection/`, `undo/`), not a role (`utils/`, `helpers/`). `src/lib/test/invariants/lint/directory-layering.test.ts` pins which top-level directory of `src/lib` may import which. A new edge fails, and adding it to the baseline needs a reviewer's agreement.

## Formatting

Prettier owns it: `npm run format` writes, `npm run lint` checks. `npm run lint` is four checks in a row (Prettier, docs links, docs paths, ESLint). The failure names which, so look before you blame formatting.
