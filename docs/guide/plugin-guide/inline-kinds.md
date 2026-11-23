# Inline kinds

Part of the [plugin guide](../plugin-guide.md). The block tier it mirrors is in [the quickstart](../plugin-guide.md#the-first-fifteen-minutes).

Syntax inside a paragraph is an inline construct your plugin lists in `contributes(...).inlines`. Three makers, all on `@voithos-labs/aragonite/plugin`:

- **`inline()`**: your own syntax, claimed at a prefix and drawn as a widget, as a built-in image or link, or as its own bytes with a class.
- **`mark()`**: a rich-text mark like a highlight, edited the way `**` is.
- **`markerPair()`**: two markers around ordinary text, like a comment's anchor, which draw nothing.

A construct reads only in an editor running your plugin; another editor on the page sees plain text. The editor names it after your plugin (`wiki/note`), and that name is what `piece.is` takes.

## A claim

Every `inline()` starts with three fields:

- **`prefix`**: what every claim starts with. One character the editor doesn't read itself (`#`, `{`, `%`), or two or more that start with one it does (`[[`, `![[`). A bare `[` or `*` is refused, since the editor reads those first.
- **`match`**: a regex, matched right at the prefix, or a function `(text, at, end)` that returns where the claim ends (-1 for none).
- **`read`**: turns the match into the claim's data. Return `null` and the bytes go back to the editor, read as if your plugin weren't there.

Keep a miss short: your matcher runs at every prefix in the paragraph. For anything bracketed, use the function form, as the recipes here do: it reads only as far as it must, and its `read` gets the claim's bytes. A regex that can read past the next prefix (`\[\[[^\]]*\]\]` runs to the end of the block on every unclosed `[[`) goes quadratic on a long line of them.

Three optional fields: `after` (constructs on the same character yours is tried after), `pair` (a one-character prefix writes its twin as it's typed, the way `$` does in the math plugin), and `split` (`'whole'` by default: Enter or a paste inside a claim moves to its nearer edge; `'plain'` cuts its bytes where the caret is).

## A wiki link: a widget

```ts
import { definePlugin, inline } from '@voithos-labs/aragonite/plugin';
import { svelteView } from '@voithos-labs/aragonite/svelte';
import WikiLink from './WikiLink.svelte';

const note = inline({
	name: 'note',
	label: 'Wiki link',
	prefix: '[[',
	// Past the first ]], with no bracket or line break before it.
	match: (text, at, end) => {
		for (let i = at + 2; i + 1 < end; i++) {
			if (text.startsWith(']]', i)) return i > at + 2 ? i + 2 : -1;
			if ('[]\n'.includes(text[i])) return -1;
		}
		return -1;
	},
	read: (claim) => ({ target: claim.slice(2, -2) }),
	sample: '[[Groceries]]',
	widget: { delete: 'select-first', arrows: 'into', click: 'follow' },
	draw: svelteView(WikiLink),
	follow: ({ target }) => openNote(target)
});

export const wiki = definePlugin({
	name: 'wiki',
	version: '1.0.0',
	editor: '^0.11.6',
	contributes: () => ({ inlines: [note] })
});
```

`see [[Groceries]] later` now draws `Groceries` through your component. The arrows show its bytes for editing, and the click the host picked for links runs `follow`.

One overlap the editor settles for you: where the bracket your claim starts on closes as a built-in link or image inside your claim, the link wins. `[[a]](https://x.dev)` is a link whose text is `[a]`, as GitHub reads it. A claim that ends first keeps its bytes, so a matcher that lets a `[` inside keeps `[[[[deep]]` of `[[[[deep]]]](https://x.dev)`. Only that first bracket counts: `[[ref]]` stays yours with a `[ref]` link defined.

## Rendering it as a widget

`draw` fills an element the editor made for the widget. The editor marks that element with the bytes it stands for, so the caret walks it as one unit and you can't get that wrong. `svelteView(Component)` mounts a Svelte component; React and Vue have their own helpers, below. A view is also just a function, `(target, props) => ({ update?, destroy? })`, and decoration widgets and inline menu rows take the same shape.

The props, `WidgetProps<D>`:

| Prop | What it's for |
| --- | --- |
| `data` | What your `read` returned |
| `source` | The claim's bytes |
| `from`, `to` | Its bytes in the document, read when you ask, so they're right after edits above it |
| `mode`, `theme` | The presentation mode (a `Mode`: its `name`, whether it's `editable`, where `markers` show) and the theme name; the drawing gets an update when either changes |
| `editor` | The editor, for anything else, like `editor.edit()` |
| `depends` | What your `depends(block)`, beside `draw`, answered for each top-level block; empty without one ([reading the document](reading-the-document.md)) |

A drawing gets an update when its bytes, its place, the mode, the theme or its `depends` answers change. A changed `source` mounts a fresh one.

**Lay it out inline.** `inline-block` for a box. A block-level `display` leaves no line beside it, so a letter typed next to it lands on the line below. A box taller than the text (a card, a chart) sets `height: 'tall'`, and the editor draws the caret beside it at the text's height.

**A throw costs only the widget.** A throw while it mounts, updates or goes away is caught: the claim shows its bytes and the `error` event gets one report. A runtime error after that is yours, so draw bad input as an error instead of throwing.

**Say how it reads.** Beside `draw`, `textContent(data)` is what a reader reads the widget as: `block.textContent`, an outline's label. The emoji plugin answers the glyph, so a heading's `:tada:` lists as 🎉. Without it, the widget reads as its bytes.

### In React and Vue

A chip for every `{{name}}`, drawn by a React component:

```tsx
import { inline, type WidgetProps } from '@voithos-labs/aragonite/plugin';
import { reactView } from '@voithos-labs/aragonite-react';

function Chip({ data }: WidgetProps<{ name: string }>) {
	return <span className="chip">{data.name}</span>;
}

const chip = inline({
	name: 'chip',
	label: 'Chip',
	prefix: '{{',
	match: /\{\{(\w+)\}\}/,
	read: ([, name]) => ({ name }),
	sample: 'a {{pebble}} chip',
	widget: { delete: 'whole', arrows: 'over', click: 'none' },
	draw: reactView(Chip)
});
```

In Vue it's `draw: vueView(Chip)`, with a single-file component that declares `defineProps<WidgetProps<{ name: string }>>()`. `vueView` hands it only the props it declares. Both helpers come from the React and Vue packages ([React and Vue](react-and-vue.md#widgets-decorations-and-menu-rows)).

## The editing policy

`widget` says how the caret and the delete keys treat it:

| Field | What it decides |
| --- | --- |
| `delete` | `'whole'`: one press deletes it. `'select-first'`: the first press selects it, the second deletes |
| `arrows` | `'over'`: an arrow steps over it like a character. `'select'`: an arrow selects it whole. `'into'`: an arrow shows its bytes for editing |
| `click` | `'source'`: a click shows its bytes. `'follow'`: the host's link click runs your `follow` (the two go together). `'none'`: a click puts the caret beside it |
| `height` | `'tall'` for a box taller than its line |
| `inner(source)` | Where the caret may sit in the shown bytes: `$x$` answers `{ start: 1, end: 2 }` |
| `caret(el, point)` | The offset into the bytes a click on your drawing names, for a drawing only you can map |

With `click: 'follow'`, another click shows the bytes if `arrows` is `'into'`, and puts the caret beside the widget otherwise. Which click follows is the host's call: Ctrl or Cmd-click by default, any click in live mode under `linkClick: 'plain'`, any click in reading mode.

A widget that should take keys while it's selected (a resize, say) adds `key(event, props)`: return `true` to take the key, and write through `props.editor.edit()`.

## A hashtag: styled text

Not everything needs a component. The `class` arm draws a claim as its own bytes in a span with your class, and the caret edits it like text:

```ts
const tag = inline({
	name: 'tag',
	label: 'Tag',
	prefix: '#',
	match: /#[\p{L}\p{N}_/-]+/u,
	read: (m) => ({ tag: m[0].slice(1) }),
	sample: 'filed under #work',
	class: 'tag',
	follow: ({ tag }) => openTag(tag)
});
```

`follow` runs on the click the host picked for links, as it does on a widget. Any other click puts the caret in the tag, so it stays text you edit.

## Your syntax, a built-in image or link

`as: 'image'` and `as: 'link'` read your bytes as a real image or link, so the resize handles, the link card and Mod+K all work. Since the editor writes a GFM image or link back, an edit comes back to your `write` instead, to put in your syntax:

```ts
const embed = inline({
	name: 'embed',
	label: 'Embed',
	prefix: '![[',
	match: /!\[\[([^[\]|\n]+)(?:\|(\d+))?\]\]/,
	read: ([, src, width]) => ({ src, width: width ? Number(width) : null }),
	sample: '![[cat.png|300]]',
	as: 'image',
	image: ({ src, width }) => ({ src, alt: src, title: null, width, height: null }),
	write: (image) =>
		image.title === null && image.height === null && image.alt === image.src
			? `![[${image.src}${image.width === null ? '' : `|${image.width}`}]]`
			: null
});
```

Return `null` for an edit your syntax can't hold (here a title, a height, or alt text that isn't the file name), and the editor refuses the edit instead of writing something you didn't author. Read every field the edit can set, or refuse it: a field you ignore writes the same bytes, and that edit just does nothing. With no `write`, every edit is refused. A link's `text` must be a run of your bytes: it's what the caret edits, while the rest hides in live mode. Give `at`, where the text starts in the claim, whenever the text can appear elsewhere in it (an alias: `[[notebook|note]]`). Without it such a claim stays plain text, and a dev build warns.

## A highlight: `mark()`

```ts
import { mark } from '@voithos-labs/aragonite/plugin';

const highlight = mark({
	name: 'highlight',
	label: 'Highlight',
	marker: '==',
	chord: 'Mod+Shift+h',
	tag: 'mark',
	class: 'highlight',
	sample: 'a ==bright== word'
});
```

`==bright==` draws `bright` in a `<mark class="highlight">`. It edits as `**` does: its runs hide in live mode, a letter typed at its end joins it, Enter inside closes it and reopens it, and typing `==` pairs. A run of another length stays text, as `~~~` does. The marker is one character, once or twice, that the editor doesn't read itself.

The `chord` is required, because where the runs hide it's the only way out of the mark at its edge. It runs `highlight.toggle`, a command like any other, so a host rebinds it by its id (`your-plugin/toggle-highlight`). Two marks written at one place nest by `after`, which names the mark yours sits inside.

## A comment anchor: `markerPair()`

```ts
import { markerPair } from '@voithos-labs/aragonite/plugin';

// A side: its prefix, an id of letters, digits and hyphens, then }.
const side = (text: string, at: number, end: number) => {
	let i = at + 3;
	while (i < end && /[\w-]/.test(text[i])) i++;
	return i > at + 3 && i < end && text[i] === '}' ? i + 1 : -1;
};
const id = (claim: string) => ({ id: claim.slice(3, -1) });

const anchor = markerPair({
	name: 'anchor',
	label: 'Comment anchor',
	open: { prefix: '{>>', match: side, read: id },
	close: { prefix: '{<<', match: side, read: id },
	key: ({ id }) => id,
	sample: 'a {>>c1}noted{<<c1} word'
});
```

Each side is its own construct, claimed wherever it stands, in one block or in two. Pairing them is yours: find the sides with `piece.is(anchor.open)` and `piece.is(anchor.close)`, and match them up by their data (`piece.data` holds what the side's `read` returned, here the id). A side with no partner is still a side.

A side draws nothing in live mode and its bytes in source mode; in preview-inline it shows once the caret is beside it. A letter typed at a side joins its pair's text, so `a noted word` with the caret before `noted` types inside the anchor, and so does the end of `noted`. Backspace beside a side takes the character you see, never the side. Emptying the text keeps both sides, whether it goes key by key, by a word delete or as a selection, and the next letter lands between them.

The editor pairs the sides for one thing, a removal in live mode. A selection or a word delete that crosses one side puts that side back where the cut ends, so the anchor shrinks to the text that's left. One that crosses both takes the anchor. A copy or a cut carries an anchor only with both its sides, and a paragraph cut whole takes the anchor it wraps along. `key` says which sides belong together, so overlapping anchors keep their own; without it the editor pairs by nesting order, which gets `{>>a}x{>>b}y{<<a}z{<<b}` wrong. Source mode takes the bytes selected.

That pairing reaches one paragraph, or the two a selection joins. Inside one paragraph a side whose partner it can't see stays, so an anchor over two paragraphs keeps its end when a word delete crosses it, and a side with no partner can't be deleted in live mode (source mode deletes it). An anchor over two paragraphs still loses an end when a selection takes that paragraph whole, and a selection from a paragraph into a table can leave a lone side. A cut across both paragraphs that crosses one end keeps that end and carries a copy too, so one id can show up on two sides of the same kind. Expect both now and then, and clear or repair them in your plugin.

`text` changes which side of each marker a letter typed at it joins. The default is `{ open: 'after', close: 'before' }`, the text between them; `{ open: 'before', close: 'after' }` makes an anchor that never grows at its ends.

## The `setup` registrars

`registerInlineSyntax`, `registerInlineWidgetKind` and `declarePluginInlineKind` still work on a `setup` plugin, and they're on their way out. New syntax belongs in the makers above.
