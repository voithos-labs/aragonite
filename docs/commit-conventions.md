# Commit Message Conventions

## Format

Each commit message starts with a symbol prefix indicating the type of change:

| Symbol | Meaning                 | Example                               |
| ------ | ----------------------- | ------------------------------------- |
| `+`    | New feature or addition | `+ user authentication`               |
| `-`    | Removal                 | `- deprecated search endpoint`        |
| `~`    | Small change or tweak   | `~ swap test runner to vitest`        |
| `>`    | Normal to large change  | `> refactor source reconciliation`    |
| `!`    | Bug fix                 | `! fix off-by-one in search scoring`  |
| `@`    | Documentation or config | `@ update README.md with conventions` |

## Rules

- Keep the message short and lowercase (no period at end)
- Focus on _what_ changed, not _how_
- Scope with parentheses when useful: `+ (editor) block parser`
- Double check code behaviour before committing. It's better to commit a fix that actually fixes the issue rather than committing fix 1, fix 2, and fix 3 on the same bug separately.

## Example

The commit msg might be:

```
+ (editor) undo/redo
! (editor) editor now editable when empty
```
