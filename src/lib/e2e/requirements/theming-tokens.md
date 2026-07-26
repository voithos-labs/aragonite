# Feature: theme tokens — host-scalable editor text

Editor-owned tokens are declared at `.editor` scope (never `:root`), so an
extracted module injects nothing into a consumer's global scope.
`--editor-font-size` is the type-scale root: the editor sizes its own text from
it and every construct sizes in `em` off that, so one host declaration scales
headings, code, markers and inline widgets together.

## Happy paths

- Setting `--editor-font-size` at `.editor` scope makes a paragraph's computed font-size exactly the declared value.
- A heading scales with it in the same declaration — the type scale rides the token rather than being re-anchored per construct.

## Edge cases

- The default declaration lives at `.editor` scope, so it SHADOWS a value inherited from a host wrapper: declaring the token on an ancestor leaves the editor's text unchanged. Hosts override at `.editor` — a plain `.editor { … }` rule beats the `:where()` default.
- A host whose dynamic value lives on an ancestor (a zoom setting on its shell) bridges it at `.editor` scope: `.editor { --editor-font-size: var(--host-zoom, 1rem) }` scales with the ancestor's value.
