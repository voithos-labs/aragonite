# Inline kinds

Part of the [plugin guide](../plugin-guide.md). The block tier's declare, describe, recognize calls it mirrors are in [the quickstart](../plugin-guide.md#the-first-fifteen-minutes).

Blocks are only half the story. An inline kind takes three calls, mirroring the block tier's declare, describe, recognize:

- **`declarePluginInlineKind(name)`** creates the inline kind and returns it, exactly as `declarePluginKind` does one level up; `declaredPluginInlineKind(name)` recovers it in a module that didn't create it.
- **`registerInlineSyntax(trigger, recognizer, options?)`** hooks the inline scanner on a single **trigger** character: at each occurrence of the trigger, your recognizer claims the syntax by returning a node, or declines with `null`. The options carry the prefix and rewrite machinery this section works through.
- **`registerInlineWidgetKind(kind, descriptor)`** says how the kind renders and edits: as a live **atomic widget**, one indivisible rendered thing the caret can sit beside but not inside, with the editing policy this section closes on.

The three together, for a `:shortcode:` kind:

```ts
const shortcode = declarePluginInlineKind('shortcode'); // 'shortcode', branded
// A bare trigger. Once directives or the bundled emoji are on, `:` is shared with the
// directive text tier (the default, INLINE_PRIORITIES.plugin) and emoji (plugin + 10).
registerInlineSyntax(':', recognizeShortcode, { priority: INLINE_PRIORITIES.plugin + 20 });
registerInlineWidgetKind(shortcode, {
	isWidget: (node) => node.kind === shortcode,
	component: ShortcodeWidget,
	editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
});
```

The inline tier isn't the block surface in miniature, though: **no keymap, no commands of its own, and no per-node metadata** (unlike a block kind, it stores nothing on the node beyond its bytes).

## Rendering it as a widget

A widget renders through one of two paths, and the descriptor rejects declaring both:

- **A `component` (recommended).** Supply a Svelte component; the editor wraps it in the widget's wrapper element and mounts it with frozen `{ inline, source }` props. Typing next to a widget keeps its instance, which is only remounted when its own source text changes.
- **A hand-built `buildWidget`.** Return the wrapper's DOM yourself when you need DOM-level control. Start from `mintWidgetShell`, which stamps the attributes the editor needs to find the widget's bytes, then add the body. This is the lower-level path the image and emoji widgets use.

Beside the frozen pair, a component gets these props, every one of them always passed. A test that mounts your widget by hand passes its own (a fixed mode, a stub `navigateTo`), and the types won't let it forget one.

| Prop                              | What it's for                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPresentationMode`, `getTheme` | The effective presentation mode and the theme name. Getters, like the next two, because an instance outlives a mode switch and edits elsewhere, and a captured value would go stale                                                                                                                                                                                                                                                         |
| `getDocument`                     | The read-only root document                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getContentVersion`               | A number that changes whenever the document's bytes change, and is stable otherwise                                                                                                                                                                                                                                                                                                                                                         |
| `navigateTo(path, offset?)`       | The editor's jump route: it reveals that block, scrolls it into view, and lands the caret in it (at a raw offset, if you pass one). A container path lands at the start of its first line (a quote's first paragraph, a list's first item), and a closed `<details>` on the way gets opened. For a widget that points somewhere else, the way a footnote reference points at its definition. It resolves false when there's nowhere to land |
| `computeInlineContent`            | The same parse `EditorContext.computeInlineContent` gives a plugin. Walk inline nodes through it and syntax the editor left out comes back as plain text                                                                                                                                                                                                                                                                                    |

Three habits for those props:

- **Key a cache on `computeInlineContent` too.** Editing a link reference definition (a line like `[r]: /x`) can change how a block parses without touching that block's bytes, and the editor hands you a new function whenever the definitions change. The bundled footnotes plugin does exactly this, since `[t [^x]][q]` hides its footnote until `[q]` gets a definition (brackets are fun like that).
- **Memoize a whole-document read on the content version.** Read the version inside the same `$derived` and use it as your memo key. The document itself isn't a usable key: the editor mutates it in place, so its identity never changes, and an identity-keyed memo hits forever on a stale answer. Reading the version inside the derived is also what subscribes your widget to edits anywhere.
- **Take a click of your own with `claimsActivationClick`.** If your `revealSource` widget handles a click itself, declare `claimsActivationClick` in its editing policy and read `isWidgetActivationClick` to decide when to act: the reveal then skips exactly that gesture, so the widget isn't swapped for its source bytes under a click meant to navigate. Add `plainClickActivates` and any click is the gesture, Ctrl or not: act on every click in your component, and the source is reached with the arrow keys instead.

**Errors in a component widget are half yours.** A throw while the widget mounts is caught (the widget falls back to its raw source and an `error` event fires), but nothing catches a runtime error after that. Render a legible error for bad input instead of throwing (the KaTeX widget shows the formula's source in red, with the parser's message on hover). A renderer slot catches a throw and hands it to your `failed`, and `renderSourceFallback(source, message)` gets you most of that view: the source in the code font and the message on hover, with the red left to you.

## Choosing a trigger

**A bare trigger must be a character no built-in scanner claims.** Registering a bare recognizer on a reserved trigger (`` ` ``, `&`, `<`, `*`, `_`, `~`, `[`, `]`, `!`, `\`, or newline) throws, since built-in dispatch runs first and a bare recognizer there would never fire. The trigger is one character; anything longer throws too.

**Several recognizers can share one trigger**, as long as each sits at its own priority or prefix (the same trigger, prefix and priority twice throws). The bundled **emoji** plugin (`@voithos-labs/aragonite/plugins/emoji`) is the bare-trigger recipe end to end: `:shortcode:` recognizes on the bare `:` trigger at `INLINE_PRIORITIES.plugin + 10`, next to the directive text tier's `:` at the default, renders through `buildWidget` + `mintWidgetShell`, and carries the `{ deleteGranularity: 'atomic', onEdge: 'step-over' }` edge policy so Backspace removes the whole `:name:` in one press and an arrow steps over it. A name it doesn't know declines and falls through to the next recognizer.

**A symmetric delimiter can close itself as it is typed.** Pass `autoPair: true` on a bare trigger whose construct opens and closes on the same byte, the way the bundled latex plugin does for `$…$`: typing the trigger lands its twin after the caret, typing it again over that twin steps past it, and a first body byte that leaves the pair no construct (`$5` is a price) drops the twin again. Without it a lone `$` typed ahead of an existing formula pairs with that formula's closer and wraps the prose between them. The built-in backtick, `*`, `_` and `~~` behave this way without registration. (`autoPair` with a `prefix` throws; it's for bare triggers.)

**To claim syntax that begins on a reserved trigger, register a prefix handler.** A **prefix** handler is only asked where its multi-character prefix matches at the cursor. A GFM (GitHub Flavored Markdown) `[^label]` footnote reference starts on `[`, which the link scanner owns. Pass a `prefix` of two or more characters that begins with the trigger, and a `priority` below `INLINE_PRIORITIES.builtin`, the inline mirror of an opener pricing below a built-in (the order is `{ prefixOverride: 40, builtin: 50, plugin: 100 }`, and a reserved-trigger handler at or above `builtin` throws):

```ts
registerInlineSyntax('[', recognizeFootnote, {
	prefix: '[^',
	priority: INLINE_PRIORITIES.prefixOverride
});
```

The scanner asks your handler ahead of the built-in `[` case, but only when `[^` matches at the cursor, so a plain `[` that opens a link is untouched. Your recognizer claims `[^label]` by returning a node, or declines with `null`, and a `[^` that never closes should decline so the built-in link reading gets it back. Handlers on one trigger are asked by priority ascending, then longer prefixes first, then lexicographic, never by registration order. Reach for a replace decoration ([Decorations](decorations.md#decorations)) only to annotate bytes you do **not** own; syntax that's genuinely your kind's belongs in a prefix handler.

The bundled **footnotes** plugin (`@voithos-labs/aragonite/plugins/footnotes`) is this recipe end to end and the worked reference to read against your own inline kind: `[^label]` recognizes through a `[^` prefix handler at `INLINE_PRIORITIES.prefixOverride`, renders as a superscript widget whose number comes from a walk of the whole document (memoized on the content version, the habit above), reveals its source to edit, and jumps to its definition on the activation click.

**`!` takes a prefix handler; `]` doesn't.** A prefix handler on `!` is what lets an Obsidian-style `![[embed]]` be a real inline kind. A prefix handler on `]` throws.

A handler on `!` is asked ahead of the built-in `!` case, so it outranks the image grammar wherever its prefix matches. And the two grammars do overlap: an image whose alt text opens with `[` starts on `![[` as well, so `![[a.png]]` carrying a parenthesized destination after it is a built-in image with the alt text `[a.png]`, not an embed. Deciding that overlap is your recognizer's job. Decline it (return `null`) and the built-in image reads the bytes unchanged. **Getting it wrong fails silently.** An ungated `![[` recognizer swallows the image with no throw and no dev warning, and the bytes still round-trip, so no round-trip test will see it. The inline kit's `overlapDecline` cell will, if you hand it the overlap ([plugin-testing.md](../plugin-testing.md)). Otherwise the first report comes from a reader whose picture stopped rendering.

## Keeping a decline cheap

**Bound the decline, not just the claim.** Your recognizer is asked at every occurrence of its trigger, so a decline that searches to the end of the block costs one block scan per trigger, which goes quadratic on a large paragraph, and the trigger is often ordinary prose (`$HOME $PATH …` for `$`). Stop at the first character your grammar can't contain, the way the emoji recognizer stops at the first non-shortcode byte. Where the grammar has no such character, index the candidate positions once per block with `createScanIndex` (hand it your position collector, get back a "first candidate at or after this offset" lookup), the way the bundled math recognizer indexes every `$` and the footnote one its closers:

```ts
const dollarAt = createScanIndex((raw) => {
	const hits: number[] = [];
	for (let i = 0; i < raw.length; i++) if (raw[i] === '$') hits.push(i);
	return Int32Array.from(hits);
});
dollarAt('pay $HOME $5 for $x$', 5); // 10, the first candidate at or after offset 5
dollarAt('pay $HOME $5 for $x$', 20); // -1, none left
```

## Building a built-in node

**If your handler builds a built-in kind's node, it owns writing those bytes back.** A handler may return a node of a kind the editor already has, say an `![[cat.png|300]]` that is a real `image`, so the widget renders it, the caret addresses it, and the resize handles appear. The catch is writing: when an edit (a resize, say) rewrites the node, the editor writes an image the only way it knows, so `![[cat.png|300]]` comes back as a GFM image (bracketed alt, parenthesized destination) and your syntax is gone. Supply a `rewriteImage` hook and the edit comes back to you instead:

```ts
registerInlineSyntax('!', recognizeEmbed, {
	prefix: '![[',
	priority: INLINE_PRIORITIES.prefixOverride,
	rewriteImage: (source, fields) => {
		if (!source.startsWith('![[')) return null; // bytes this handler did not shape
		// Decline what this grammar cannot store rather than dropping it silently: it
		// holds a target and an optional width and nothing else. The alt line is THIS
		// recognizer's version of that rule: it fills alt and url from the one target,
		// so an alt that no longer matches is an edit with no form here. Write yours
		// against however your own recognizer fills the node.
		if (fields.title !== undefined || fields.label !== undefined) return null;
		if (fields.height !== undefined || fields.crop !== undefined) return null;
		if (fields.alt !== fields.url) return null;
		return `![[${fields.url}${fields.width !== undefined ? `|${fields.width}` : ''}]]`;
	}
});
```

`source` is the node's current bytes; return their replacement in your grammar. Return **`null` when the edit has no form in your syntax** (an embed has nowhere to put a title) and the editor declines the edit rather than writing something you didn't author. **A handler with no hook declines every such edit**, which is the safe default: the affordance visibly does nothing, and a dev build logs which handler declined and why.

Three edges the snippet above is shaped by, and each one bites if you drop it:

- **Read every field, or decline it.** A hook that ignores a field the user edited returns the same bytes, and an edit that changes nothing is dropped **silently, with no dev warning**. The Alt row of the editor's image-properties popover then simply does nothing, and so does an unlocked resize (it writes `height`) or a crop. Decline instead, and the dev build at least tells you.
- **Guard every optional field you interpolate.** `fields.width` is absent on an embed that never carried one, and an unguarded template writes the literal `|undefined` into the document.
- **Bound the hook to bytes you shaped.** The claim reaches _descendants_ of the node your recognizer returned, so a handler that returns its own kind wrapping a built-in `image` gets called with the **inner** node's slice, not the whole construct. Checking `source` before rewriting is what keeps that from nesting your syntax inside itself.

## The editing policy

The policy on your widget registration says how the caret and the delete keys treat it. Its fields, all optional:

| Field                   | What it decides                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revealSource`          | Open the source (the `$…$` bytes) for editing on caret entry; inline math's model                                                                                                                                                                                                                                                                          |
| `revealContentSpan`     | Where the editable content sits inside the source (`$x$` answers `{ start: 1, end: 2 }`), so a caret entering the source stays between the delimiters; absent, it keeps the leading edge                                                                                                                                                                   |
| `revealOffsetAtPoint`   | Which source offset a press on the rendered widget names, so a click puts the caret where it landed; inline math walks its KaTeX glyphs for this, and `null` falls back to the content span's end                                                                                                                                                          |
| `onSelectedKey`         | A handler for keys while the widget is selected; image resize rides it                                                                                                                                                                                                                                                                                     |
| `onEdge`                | `'select' \| 'step-over'`: an edge press selects the whole widget, or steps transparently over it; `'step-over'` also makes a press on the widget put the caret at the edge it landed by, where `'select'` leaves the widget its own click; and Up or Down onto a block holding only a step-over widget puts the caret beside it, one press in and one out |
| `deleteGranularity`     | `'atomic' \| 'select-then-delete'`: one press deletes the whole widget, or the first press selects and the second deletes                                                                                                                                                                                                                                  |
| `claimsActivationClick` | Your component handles the activation click itself, so the reveal does nothing for it; the footnote jump's model                                                                                                                                                                                                                                           |
| `plainClickActivates`   | A plain click is the activation click too, as a link on a web page is: the source never opens for a click, only when the caret arrows in. Implies `claimsActivationClick`; a host's wikilink model                                                                                                                                                         |
