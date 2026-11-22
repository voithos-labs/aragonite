# Feature: the languages the highlight package answers

By default the package highlights the languages 0.11.5 did, and the language picker lists them as
0.11.5 did. A host that hands the engine `allLanguages` gets every other grammar highlight.js ships,
listed after those.

## Happy paths

- by default, the picker's rows for a fence with no language are 0.11.5's 25: `text`, then the 24
  languages by their names (`html`, not `xml`) and in its order
- with every grammar opted in, a `nix` fence paints once its grammar lands

## Edge cases

- by default, a `nix` fence stays plain while a `js` fence beside it paints
- with every grammar opted in, the picker lists 0.11.5's 25 rows first, in their order, then every
  other grammar alphabetically

## Miss-analysis

- The default set grew to every highlight.js grammar and no row said which languages a default
  install lists, so the picker's 25 rows became 194 unnoticed.
