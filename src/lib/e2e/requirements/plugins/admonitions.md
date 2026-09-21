# Feature: Admonitions plugin, the dogfood battery

The admonitions dogfood registers one `admonition` container kind that five directive names
(`note`/`tip`/`important`/`warning`/`caution`) resolve into, reading their variant back from
metadata. Child 0 is the editable title leaf; the opener line carries the kind and the title,
and is rebuilt from the children plus the metadata after every edit. In the composed harness the
callout dogfood takes `note`/`warning` first, so every scenario here drives a kind the
admonitions plugin owns (`tip`/`important`/`caution`).

The seed (`?seed=admonitions`) holds a heading, an untitled `:::important`, a titled
`:::tip Pro tip` and a titled `:::caution Heads up`, a convertible top-level `> [!CAUTION]`
alert, and a `> [!NOTE]` inside a code fence.
The harness has a "Convert GitHub alerts" button that runs `getSource()`
through the transform and back into `source`. The checks read the tree and the source by path
through `window.__test`; the interactions are real keyboard and mouse. The behavior when the
plugin is not installed has unit tests (`fallback.test.ts`) and is deliberately not repeated
here.

## Happy paths

- kinds render distinctly: the important, tip and caution admonitions each render a box
  carrying its own `data-kind`, so the user can tell the kinds apart
- title rendering: a titled admonition shows its title text in the title leaf; an untitled one
  shows the capitalized kind name as a placeholder (`Important`)

## User interactions

- typing in the title leaf: real keyboard input into the untitled `:::important` title fills the
  placeholder and rewrites the opener to `:::important Read me`; the source round-trips stable
- `Mod+7` cycles the kind: a real chord on the tip admonition advances it to `:::important` (the
  source changes and exactly one `metadataUpdate` edit op fires), and one `Ctrl+Z` restores
  `:::tip`, so each keypress is one undoable commit; round-trips stable
- convert button: clicking it rewrites the top-level `> [!CAUTION]` blockquote to a `:::caution`
  admonition and leaves the fenced `> [!NOTE]` byte-identical (never `:::note`, since only a
  real top-level blockquote alert converts), then disables itself because nothing convertible is
  left; the converted document round-trips stable
