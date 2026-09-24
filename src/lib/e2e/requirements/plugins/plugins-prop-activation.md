# Feature: the `plugins` prop is the enablement set

Plugin definitions are global to the process and the first one wins, but what is switched on is
per editor: an editor activates exactly the plugins its `plugins` prop lists. A plugin another
editor on the page installed, but this one did not list, runs no `onEditor` hook here, and its
syntax is not in this editor's grammar, so its bytes read as the plain Markdown they are. An
editor mounted with no prop keeps the documented default, where everything installed in the
process is active.

`/test/plugins/activation` mounts two editors over the same seed. The first lists
`parrotPlugin()`, a kind, `blockBadgePlugin`, a decoration source, `emojiPlugin()`, inline syntax
with a widget, `admonitionsPlugin()`, directive names, and the latex plugin, inline math; the
second lists only `docStatsPlugin`, which contributes a global chord and none of those. Each
editor parses the seed in its own grammar, so the first holds a parrot block, an emoji glyph, a
note and math, and the second a paragraph with the parrot bytes, the shortcode and the dollars as
text, and the fence as the generic directive. Each pane is the other's editor that did not list:
the chord belongs to the second, the parrot syntax to the first.

Miss-analysis: every plugin spec mounted one editor with every plugin it cared about, so no spec
could see two editors disagree about a plugin. `registry-enablement.md` came closest, but it
read its answer from the harness-only `__registryEnablement` hook rather than from the prop.

## Happy paths

- the editor that lists it holds the parrot node: its seed parses `%%parrot party responsibly` into a `[data-block-kind="parrot"]` block
- both trees reload as themselves in their own editor's grammar (miss-analysis: the reload check read the global grammar, so a pane whose tree followed its own grammar could not be checked at all, and no spec asked)
- the editor that lists it renders the plugin component: its parrot block shows `.parrot-block` and no `.raw-block` fallback
- the editor that lists it attaches the decoration source: its heading carries the `.badge-h` badge widget
- built-ins are untouched on both sides: each editor renders its heading and its `Body` paragraph

## Edge cases

- the editor that did not list it reads the syntax as prose: it holds no parrot block, and a paragraph shows the `%%parrot` bytes
- the editor that did not list emoji shows `:smile:` in the heading as text, while the editor that did draws the glyph widget (regression #266: inline syntax and widget kinds had no owner, so an unlisted plugin's recognizer ran in every editor; miss-analysis: this page listed no inline plugin, so no spec could see two editors disagree about a shortcode)
- the editor that did not list admonitions reads `:::note` as the generic directive container, while the editor that did holds an admonition (regression #266: directive names resolved in every editor, and the shared directive kinds were owned by whichever plugin turned directives on first; miss-analysis: every directive spec mounted one editor that listed admonitions)
- the editor that did not list it attaches no decoration source: its heading carries no `.badge-h`, which proves the `onEditor` hook never ran there
- the chord belongs to one editor, not to the process: `reservedChords()` and `claimsChord()` report `Mod+Shift+S` in the editor that lists `doc-stats` and withhold it from the one that does not (regression #265: the chord was taken process-wide, so it was swallowed and ran nothing in the editor that never listed the plugin)
- a paste parses against that editor's grammar: `%%parrot dance` pasted into the editor that omits the parrot lands as prose in the paragraph it was pasted into, leaving that pane with no parrot block (regression #267: the clipboard parsed against every installed plugin, so the paste created a kind that editor resolves no component for)
- Enter at the start of the `%%parrot` paragraph in the editor that omits the parrot leaves an empty paragraph above a `%%parrot` paragraph, no parrot block, and a tree that reloads as itself (miss-analysis: the split reread both halves in the global grammar, and no spec pressed Enter in the pane that left the plugin out)
- select all of `$**x**$` and press Ctrl/Cmd+B in the editor that omits latex: the paragraph becomes `**$x$**`, one bold run over the text the editor draws, not a second run nested around the dollars (miss-analysis: every format toggle test ran with each installed plugin active, so no case toggled over syntax an editor left out)
- End then Enter after `Tip` inside the generic directive box, in the editor that omits admonitions, then typing `Z`: the box takes the line and the dev shape check logs nothing, since it reparses in that editor's grammar (miss-analysis: the unlisted directive case only counted kinds, and no spec edited inside the generic box of an editor that left its plugin out)

## User interactions

- the activation scenarios navigate and nothing more; both editors are read by DOM class, since what matters is what each instance resolved rather than what either can edit
- the paste scenario is a real gesture: click into the paragraph, End, then Ctrl/Cmd+V over a seeded clipboard; the split one is a click, Home, then Enter; the bold one is a click, Home, Shift+End, then Ctrl/Cmd+B; the directive one is a click on `Tip`, End, Enter, then typing
- the chord scenario asks the instance's own API rather than pressing the key: what a host needs to know is whether the editor takes the chord, and only `reservedChords` and `claimsChord` answer that
