# Commit Conventions

A commit message opens with a symbol saying what kind of change it is. Yes, symbols. `git log` is
something you skim, and a wall of prose prefixes does not skim:

| Symbol | Meaning                |
| ------ | ---------------------- |
| `+`    | New feature            |
| `-`    | Removal                |
| `~`    | Small tweak            |
| `>`    | Normal to large change |
| `!`    | Bug fix                |
| `@`    | Docs/config            |

Rules:

- Line 1 is the whole summary: lowercase, no trailing period, plain words, **72 characters hard**
- The subject says what changed; the diff says how. **No essay bodies.** A body is exceptional: at most 3 short lines, only when the subject genuinely cannot carry it (a breaking-change note, a non-obvious constraint)
- Scope in parens when useful: `+ (editor) block parser`. Comma-separate several, no space: `> (editor,plugins) …`
- One logical change per commit. Bundle small related edits into medium-sized commits rather than micro-commits. Nobody wants to bisect through forty commits that each moved a semicolon
- A commit holding several changes summarizes on line 1 and lists the changes in the body, below a blank line:

```
> (schema) the opener and descriptor registries merge

+ (schema) one registry keyed by block kind
- (core) the per-kind branch in the parser
```

Those per-change lines are subject lines in their own right and carry every line-1 rule. They sit below a blank line because `git log --oneline`, and every other reader of `%s`, joins a multi-line first paragraph into a single line: three 72-character lines would arrive as one 216-character line, which is the shape the cap exists to prevent.

- Verify behavior before committing
- No attribution trailers (no `Co-Authored-By`, no "Generated with"). The git history is not a credits reel

## The shape is enforced

`scripts/lint-commit-message.mjs` holds the only definition of the shape above, and the same
script runs at two checkpoints, so nothing above depends on you remembering it:

| Checkpoint        | Where                                                                                 | Catches                                   |
| ----------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `commit-msg` hook | `.githooks/`, wired by `npm install` (a `prepare` script sets git's `core.hooksPath`) | every local commit, before it exists      |
| CI step           | the `unit` job, over the pull request's own commits                                   | a contributor who never ran `npm install` |

What it reads:

- line 1: symbol, an optional `(scope)` (lowercase; digits, commas, `/` and `-` allowed), then the text, no trailing period, at most 72 characters. The text may open with an identifier (`G1.38`, `CST`, `WebKit`); what gets rejected is an ordinary capitalized word
- line 2, when anything follows: blank
- the body: either per-change lines, where **every** line is symbol-prefixed and held to the line-1 rules, or prose, at most 3 lines of at most 100 characters
- no `Co-Authored-By` or "Generated with" trailer, anywhere

Exempt, because no convention of ours writes them: `Merge …`, `Revert "…"`, dependabot's
`Bump …` and `build(deps…`, and git's own `fixup!` / `squash!` (those never reach a pull
request unsquashed, and the CI checkpoint catches a leftover).

To read the verdict yourself before you open a pull request (the same line works in bash
and PowerShell):

```bash
node scripts/lint-commit-message.mjs --range origin/dev..HEAD
```

## Bug fixes carry a miss-analysis

Every `!` fix records one line: **what test should have caught this, and why none did.** It lives in the regression test's requirement file (e2e) or as that test's own header line (unit), never in the commit message. See `docs/contributing/rules.md` § Fixing bugs.

One line. It is the line that keeps the same blind spot from being rediscovered next quarter by somebody who will also be certain they found it first.
