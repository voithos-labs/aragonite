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

The rest of this page takes a first-time contributor from a clone to a merged pull request.

## Setup

Use node 24, the one CI runs.

```
npm install
npx playwright install chromium
npm run dev
```

Don't skip the second line: the e2e suite and the perf gate both drive Chromium. The third serves the showcase at `/` and the dev harness at `/test/editor`. On WSL with the checkout on a Windows drive (`/mnt/c/...`), the file watcher gets no events, so your edits appear to do nothing and you start doubting yourself. Run `ARAGONITE_POLL=1 npm run dev` there.

## What to read first

1. Read the root [`README.md`](README.md#lossless), its Lossless section only, for the core idea.
2. Read [`docs/contributing/rules.md`](docs/contributing/rules.md), all of it, before your first edit. Yes, before.
3. Read [`docs/design/editor.md`](docs/design/editor.md), and stop at "The editing surface".
4. Open `/test/editor`, open the debug panel (Ctrl+Shift+D), type, and watch the tree.
5. Run one unit area suite (`npm run test:editor:core`, say) and read two of its files, to copy their conventions.

## The shape of the thing

There is one syntax tree. Markdown parses into it, the screen renders from it, and saving serializes it back. An edit changes the tree, and the DOM follows. That's the whole idea; everything else is bookkeeping (there is a lot of bookkeeping). These components draw the tree:

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
- **Ship gate**, before a merge or a release: the commit gate plus `npm run perf:check`, plus `npm run test:e2e:webkit` or `npm run test:e2e:firefox` when the change touches selection, typing or the clipboard.

They have a few ways of lying to you:

- `perf:check` times a production build against baselines from one calibration machine, so anywhere else it reads red by design. Off that machine its red is a hint, not a verdict: CI's scaled perf job decides. `test:editor:perf` is not the ship gate, since it already runs inside `npm test`.
- Don't pipe a gate command. bash reports the pipe's last exit code, and so does PowerShell when the last stage is another program, so a failure looks like a success. Redirect to a file and check the exit code.
- Run the full e2e suite and the simulation with nothing else running on the same tree, because contention produces false failures. Some e2e specs also keep absolute time budgets that a slow or busy machine can miss. CI is the verdict there too.
- An interrupted e2e run can leave its server holding the port, and the next run dies on the spot. Kill the server and rerun.

## Commit messages

`npm install` sets up a `commit-msg` hook that rejects anything but this, and CI runs the same linter over the pull request's commits, so the hook is the friendlier of the two.

- The subject is a symbol, an optional `(scope)`, then lowercase text: `! (parser) off-by-one in heading detection`. No final period, 72 characters at most.
- The symbols are `+` feature · `-` removal · `~` small tweak · `>` normal to large change · `!` bug fix · `@` docs or config.
- Several scopes are comma-separated with no space. The text may start with an identifier (`CST`, say), but not with an ordinary capitalized word.
- A body is the exception: three short lines at most, 100 characters each, and only when the subject can't hold it.
- Several changes in one commit get a summary line, a blank line, then one symbol-prefixed line per change. Still, one logical change per commit; aim for medium, not micro.
- No attribution trailers (`Co-Authored-By`, "Generated with").

Merges, reverts, dependabot bumps, `fixup!` and `squash!` are exempt, and so is one co-founder (don't ask). To check yourself, run `node scripts/lint-commit-message.mjs --range origin/dev..HEAD`.

## Opening a pull request

Fork the repo, branch from `dev` in your fork, and open the pull request against `dev`. Collaborators can branch in place. Never target `main`: it's the release branch, and `dev` into `main` is a merge a maintainer runs. `next` is the maintainers' working branch, so not that one either.

CI runs the lint, the type check and the unit suite, the e2e suite in Chromium, WebKit and Firefox, the perf gate, and smoke tests of the packed library. A docs-only change skips the e2e and perf work. Six checks account for most red pull requests. The commit gate includes them all, each runs alone in seconds, and `npm run test:editor:invariants` runs four of them together:

1. Every e2e spec has a requirement file, and every requirement file a spec. `src/lib/e2e/lint/requirement-spec-lockstep.test.ts`
2. A comment stays inside its line budget and uses no banned word. `src/lib/test/invariants/lint/comment-budget.test.ts`, `src/lib/test/invariants/lint/comment-house-words.test.ts`
3. A token the editor's CSS reads is declared in `src/lib/styles/editor-theme.css`, a host radius token it reads has a fallback, and `src/app.css` holds no editor rules. `src/lib/test/invariants/lint/css-ownership.test.ts`
4. A menu row's icon name is a key of the glyph table in `src/lib/menu-icons.ts`. `npm run check`, except for a block context action's icon, which is a plain string
5. No timer sequences anything, unit tests included (they wait with the helper in `src/lib/test/harness/settle.ts`). `src/lib/test/invariants/lint/file-rules.test.ts`, `src/lib/test/invariants/lint/suite-file-rules.test.ts`
6. A file that gains a `pointerdown` or `mousedown` handler appears in the caret-gesture scan's lists, as "places a caret" or "places none", with the reason. `src/lib/test/invariants/lint/caret-gesture-range-reset.test.ts`

Merging needs one code-owner approval. The review looks for the root cause and asks for a test alongside the fix. That's a lot to ask for a drive-by patch, and it gets asked anyway. For a gentler start, issues labelled `good first issue` are picked to be exactly that.

## Filing an issue

Bugs and feature requests go to [GitHub Issues](https://github.com/voithos-labs/aragonite/issues), which has a form for each. Questions go to [Discussions](https://github.com/voithos-labs/aragonite/discussions). Say what you saw, how to make it happen, and which version, browser and mode. A maintainer adds the labels.

And yes, the open count is known. Issues labelled `severity: watch` (a signal with no confirmed defect) or `severity: minor` stay open on purpose, because knowing they exist beats a tidy tracker.

## Two ton slab of stone

![stone](./docs/assets/stone.png)
