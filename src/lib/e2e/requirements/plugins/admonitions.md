# Feature: Plugin Admonitions — dogfood battery

The admonitions dogfood registers one `admonition` container kind that five
directive names (`note`/`tip`/`important`/`warning`/`caution`) resolve into,
reading their variant back from metadata. Child 0 is the editable title chrome
leaf; the opener line carries the kind and title, rebuilt from children +
metadata after every edit. In the composed harness the callout dogfood claims
`note`/`warning` first, so every scenario here drives an admonition-owned kind
(`tip`/`important`/`caution`).

Seed (`?seed=admonitions`): a heading, an untitled `:::important`, a titled
`:::tip Pro tip` and `:::caution Heads up`, a convertible top-level
`> [!CAUTION]` alert, and a `> [!NOTE]` inside a code fence. A harness
"Convert GitHub alerts" button rewrites `getSource()` → transform → `source`.
Gates read the CST/source by path via `window.__test`; interactions are real
keyboard and mouse. Uninstalled-fallback is unit-covered (fallback.test.ts) and
is deliberately not repeated here.

## Happy paths

- kinds render distinctly: the important/tip/caution admonitions each render a
  box carrying its own `data-kind`, so a reader can tell the kinds apart
- title rendering: a titled admonition shows its title text in the chrome leaf;
  an untitled one shows the capitalized kind name as a placeholder (`Important`)

## User interactions

- typing in the title leaf: real keyboard into the untitled `:::important`
  title fills the placeholder and rewrites the opener to `:::important Read me`;
  the source round-trips stable
- `Mod+7` cycles the kind: a real chord on the tip admonition advances it to
  `:::important` (source changes, exactly one `metadataUpdate` edit op), and one
  `Ctrl+Z` restores `:::tip` — one undoable commit per press; round-trips stable
- convert button: clicking it rewrites the top-level `> [!CAUTION]` blockquote to
  a `:::caution` admonition, leaves the fenced `> [!NOTE]` byte-identical (never
  `:::note` — only real top-level blockquote alerts convert), then disables
  itself because nothing convertible remains; the converted document round-trips
  stable
