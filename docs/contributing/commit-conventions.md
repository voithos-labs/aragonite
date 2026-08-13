# Commit Conventions

A commit message opens with a symbol saying what kind of change it is:

| Symbol | Meaning                |
| ------ | ---------------------- |
| `+`    | New feature            |
| `-`    | Removal                |
| `~`    | Small tweak            |
| `>`    | Normal to large change |
| `!`    | Bug fix                |
| `@`    | Docs/config            |

Rules:

- One subject line per change: lowercase, no trailing period, plain words, aim for under ~72 characters
- The subject says what changed; the diff says how. **No essay bodies.** A body is exceptional: at most 2-3 short lines, only when the subject genuinely cannot carry it (a breaking-change note, a non-obvious constraint)
- Scope in parens when useful: `+ (editor) block parser`. Comma-separate several: `> (editor,plugins) …`
- One logical change per commit. Bundle small related edits into medium-sized commits rather than micro-commits
- A commit holding several changes lists one subject line per change:

```
+ (editor) undo/redo
! (editor) editor now editable when empty
```

- Verify behavior before committing
- No attribution trailers (no `Co-Authored-By`, no "Generated with")

## Bug fixes carry a miss-analysis

Every `!` fix records one line: **what test should have caught this, and why none did.** It lives in the regression test's requirement file (e2e) or as that test's own header line (unit), never in the commit message. See `docs/contributing/rules.md` § Fixing bugs.
