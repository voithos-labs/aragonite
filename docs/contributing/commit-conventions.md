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

- Lowercase, no period, short
- Scope in parens when useful: `+ (editor) block parser`. Comma-separate several: `> (editor,plugins) …`
- One logical change per commit. Bundle small related edits into medium-sized commits rather than micro-commits
- Multi-line messages for multiple changes. E.g.

```
+ (editor) undo/redo
! (editor) editor now editable when empty
```

- Verify behavior before committing
- No attribution trailers (no `Co-Authored-By`, no "Generated with")

## Bug fixes carry a miss-analysis

Every `!` commit records one line in its body: **what test should have caught this, and why none did.** Not an apology — a finding. The generalized answers are what reshape the suite; three of them explained all ten bugs of the 2026-07 audit.

```
! (editor) enter at content offset 0 splits instead of no-op or corrupting

& ...
& miss-analysis: the dispatch core's unit test pinned the no-op as correct
  while no entry-level test drove a real enter at offset 0; the opener-side
  fence boundary was never modeled though its closer twin was
```

It can live in the commit message or in the requirement file for the regression test. See `docs/contributing/culture.md` § Fixing bugs.
