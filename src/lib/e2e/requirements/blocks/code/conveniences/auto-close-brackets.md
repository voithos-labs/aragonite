# Feature: Code Block — Auto-Close Brackets

Typing an opener bracket inserts the matching closer and parks the cursor between them.

## Auto-close brackets

- Typing `(`, `[`, or `{` with a collapsed cursor inserts the pair and leaves the cursor between them
- Auto-close is suppressed when the next character is an identifier char (`[\w$]`): `(` typed before `foo` inserts only `(`
- Auto-close is NOT suppressed when the previous character is an identifier: `foo(` pairs normally
- Typing a bracket with a non-empty selection wraps the selection in the pair and keeps the selection inside
