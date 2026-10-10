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
- The subject says what changed; the diff says how. **No essay bodies.** A body is exceptional: at most 3 short lines, only when the subject genuinely can't carry it (a breaking-change note, a non-obvious constraint)
- Scope in parens when useful: `+ (editor) block parser`. Comma-separate several, no space: `> (editor,plugins) …`
- One logical change per commit. Bundle small related edits into medium-sized commits rather than micro-commits. Nobody wants to bisect through forty commits that each moved a semicolon
- A commit holding several changes summarizes on line 1 and lists the changes in the body, below a blank line:

```
> (schema) the opener and descriptor registries merge

+ (schema) one registry keyed by block kind
- (core) the per-kind branch in the parser
```

Those per-change lines are subject lines in their own right and carry every line-1 rule. They sit below a blank line because `git log --oneline` joins a multi-line first paragraph into a single line.

- Verify behavior before committing
- No attribution trailers (no `Co-Authored-By`, no "Generated with"). The git history is not a credits reel

## The shape is enforced

`scripts/lint-commit-message.mjs` checks the message shape above at two points: a `commit-msg` hook that `npm install` wires up (so a bad message never becomes a commit), and a CI step over the pull request's own commits (for anyone who never ran `npm install`). Merge, revert, dependabot and `fixup!` / `squash!` commits are exempt, and so is one co-founder who writes his own subjects. A few details the list above doesn't spell out: a scope may hold digits, commas, `/` and `-`; line 1's text may open with an identifier (`G1.38`, `CST`), just not an ordinary capitalized word; and a prose body's lines stop at 100 characters.

To read the verdict yourself before you open a pull request (the same line works in bash and PowerShell):

```bash
node scripts/lint-commit-message.mjs --range origin/dev..HEAD
```

Or pipe a message straight in, to see what the hook would say before you commit it:

```bash
printf 'Fixed the thing.\n' | node scripts/lint-commit-message.mjs
```

```powershell
'Fixed the thing.' | node scripts/lint-commit-message.mjs
```

```
commit message rejected:
  line 1  subject-shape: expected `<symbol> [(scope)] lowercase text`, symbol one of + - ~ > ! @
    Fixed the thing.
  line 1  subject-trailing-period: drop the period
    Fixed the thing.
  convention: docs/contributing/commit-conventions.md
```

Every broken rule gets a line, with the offending text under it, and the exit code is 1. A pass prints nothing and exits 0.

## Bug fixes carry a miss-analysis

Every `!` fix records one line: **what test should have caught this, and why none did.** It lives in the regression test's requirement file (e2e) or as that test's own header line (unit), never in the commit message ([`rules.md`](rules.md) § Fixing bugs).
