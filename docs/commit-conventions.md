# Commit Message Conventions

## Format

Each commit message starts with a symbol prefix indicating the type of change:

| Symbol | Meaning | Example |
|--------|---------|---------|
| `+` | New feature or addition | `+ user authentication` |
| `-` | Removal | `- deprecated search endpoint` |
| `~` | Small change or tweak | `~ swap test runner to vitest` |
| `>` | Normal to large change | `> refactor source reconciliation` |
| `!` | Bug fix | `! fix off-by-one in search scoring` |
| `@` | Documentation or config | `@ update README.md with conventions` |

## Rules

- Keep the message short and lowercase (no period at end)
- Focus on *what* changed, not *how*
- Scope with parentheses when useful: `+ (editor) block parser`
