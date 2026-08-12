# Feature: theme tokens — host-scalable editor text

Tokens are declared at `.editor` scope and on the opt-in theme class, never
`:root`, so an extracted module injects nothing into a consumer's global scope.
`--editor-font-size` is the type-scale root: the editor sizes its own text from
it and every construct sizes in `em` off that, so one host declaration scales
headings, code, markers and inline widgets together. It belongs to the
host-chrome tier, so its default lives behind the opt-in class alone.

## Happy paths

- Setting `--editor-font-size` at `.editor` scope makes a paragraph's computed font-size exactly the declared value.
- A heading scales with it in the same declaration — the type scale rides the token rather than being re-anchored per construct.

## Edge cases

- The default declaration lives on the opt-in theme class, so it SHADOWS a value declared ABOVE that class: a `body` declaration leaves the editor's text unchanged. Hosts override at `.editor` — a plain `.editor { … }` rule beats the `:where()` default.
- A value declared BELOW the class, on a wrapper between it and the editor root, inherits straight in — the same path a themed host with no class uses to size the editor.
- A host whose dynamic value lives on an ancestor (a zoom setting on its shell) bridges it at `.editor` scope: `.editor { --editor-font-size: var(--host-zoom, 1rem) }` scales with the ancestor's value.
