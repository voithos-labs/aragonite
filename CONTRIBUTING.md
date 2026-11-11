Welcome. Hello. 你好。こんにちは。

So you want to work on this thing. Condolences.

Anyways, for more in depth stuff, find them here:

- [`docs/contributing/rules.md`](docs/contributing/rules.md): the rules the code can't tell you
- [`docs/contributing/glossary.md`](docs/contributing/glossary.md): what the odd words mean
- [`docs/contributing/codebase-map.md`](docs/contributing/codebase-map.md): which file to open for a behavior
- [`docs/contributing/testing.md`](docs/contributing/testing.md): where a test goes, and why it went red
- [`docs/contributing/code-style.md`](docs/contributing/code-style.md): comments, file layout, formatting
- [`docs/contributing/debugging.md`](docs/contributing/debugging.md): dumping the editor's state instead of guessing at it
- [`docs/design/editor.md`](docs/design/editor.md): how the whole thing works
- [`docs/README.md`](docs/README.md): the map of every other doc

## Setup

Be on node 24.

```
npm install
npx playwright install chromium
npm run dev
```

The e2e suite and the perf gate both drive chromium - dont skip the chromium install.

## What to read first

1. Read the root [`README.md`](README.md#lossless), its Lossless section only, for the core idea.
2. Read [`docs/contributing/rules.md`](docs/contributing/rules.md), all of it, before your first edit.
3. Read [`docs/design/editor.md`](docs/design/editor.md), and stop at "The editing surface".
4. Open `/test/editor`, open the debug panel (Ctrl+Shift+D), type, and watch the tree.
5. Run one unit area suite (`npm run test:editor:core`, say) and read two of its files, to copy their conventions.

## The shape of the thing

There is one syntax tree. Markdown parses into it, the screen renders from it, and saving serializes it back. An edit changes the tree, and the DOM follows. That's the whole idea; everything else is (a lot of) bookkeeping. These components draw the tree:

```
Editor (owns the tree and the undo stack)
└─ BlockList (one list of blocks, windowed)
   └─ BlockHost (picks the component for a block's kind)
      ├─ TextEditableBlock, CodeBlock, ThematicBreakBlock, TableBlock
      └─ BlockquoteBlock, ListBlock → ListItemBlock (each nests a BlockList)
```

A block's **kind** is the string on its node that says what block it is (`paragraph`, `list`, a plugin's name). **Windowed** means only the blocks near the viewport are mounted.

## Making a change

A bug fix has three habits: fix the class of bug and not the one instance, watch the regression test go red before you fix anything, and record a one-line miss-analysis ([`rules.md`](docs/contributing/rules.md) says where). In a dev build, a console line that starts `[aragonite:` fails a gate, and [`testing.md`](docs/contributing/testing.md) says which kind means what.

## The gates

- **Inner loop**, while you work: the area scripts (`package.json` lists them). Pick by the files you touched, not by the task's theme.
- **Commit gate**, green before every commit: `npm test`, `npm run check` (0 errors, 0 warnings) and `npm run lint`.
- **Before a pull request**: the commit gate, plus `npm run test:e2e:webkit` or `npm run test:e2e:firefox` when the change touches selection, typing or the clipboard. CI times the keystrokes for you.
- **Ship gate**, before a release: `npm run perf:check` on the calibration machine. That one is ours.

They have a few ways of lying to you:

- `perf:check` times a production build against baselines from one calibration machine, so anywhere else it reads red by design. Off that machine its red is a hint, not a verdict: CI's scaled perf job decides. `test:editor:perf` is not the ship gate, since it already runs inside `npm test`.
- Don't pipe a gate command. bash reports the pipe's last exit code, and so does PowerShell when the last stage is another program, so a failure looks like a success. Redirect to a file and check the exit code.
- Run the full e2e suite and the simulation with nothing else running on the same tree, because contention produces false failures. Some e2e specs also keep absolute time budgets that a slow or busy machine can miss. CI is the verdict there too.
- An interrupted e2e run can leave its server holding the port, and the next run dies on the spot. Kill the server and rerun.

## Commit messages

`npm install` sets up a `commit-msg` hook that rejects anything but this, and CI runs the same linter over the pull request's commits:

- The subject is a symbol, an optional `(scope)`, then lowercase text: `! (parser) off-by-one in heading detection`. No final period, 72 characters at most.
- The symbols are `+` feature · `-` removal · `~` small tweak · `>` normal to large change · `!` bug fix · `@` docs or config.
- Several scopes are comma-separated with no space. The text may start with an identifier (`CST`, say), but not with an ordinary capitalized word.
- A body is the exception: three short lines at most, 100 characters each, and only when the subject can't hold it.
- Several changes in one commit get a summary line, a blank line, then one symbol-prefixed line per change. Still, one logical change per commit; aim for medium, not micro.
- No attribution trailers (`Co-Authored-By`, "Generated with").

Merges, reverts, dependabot bumps, `fixup!` and `squash!` and finnrws are exempt. To check yourself, run `node scripts/lint-commit-message.mjs --range origin/dev..HEAD`.

## Opening a pull request

Fork the repo, branch from `dev` in your fork, and open the pull request against `dev`. Collaborators can branch in place.

Merging needs one code-owner approval. For a gentler start, prob start with some of the easier github issues, such as the ones labelled `good first issue`.

## Filing an issue

Bugs and feature requests go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues), through one of two forms (Bug, Feature request). Questions go to discussions. The form sets the issue's type, and a maintainer adds one `area:` label at triage, plus one `severity:` if it's a bug.

Note,

1. Fill the form in honestly: what you saw, how to make it happen, and which version, browser and mode.
2. Yes, I see the open count. The issues, in this repo, partly acts as a to-watch ledger; `severity: watch` tracks observed signals with no confirmed defect, those and `severity: minor` stay open - i believe knowing of their existence is relatively more improtant than recklessly tidying them away.

## Two ton slab of stone

![stone](./docs/assets/stone.png)
