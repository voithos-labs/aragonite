# Inline parsing design spec

## 1. What this is

Block parsing gets you as far as "this is a paragraph". Inline parsing is what turns the text _inside_ it into styled DOM: `**bold**` renders bold, with the `**` still visible and dimmed.

It runs on every kind that declares `supportsInline` on its descriptor (a kind is the string on a node saying what block it is, and the descriptor is that kind's metadata record: how it merges, edits, renders). Today that's paragraphs, headings, setext headings, and table cells. Cells run the identical pipeline; they just have no ambient prefix (the read-only marker a container lends its first child, a list's `- `) and no block marker to skip.

**The inline tree is derived, and disposable.** `raw` (a node's verbatim source bytes, markers included) is what gets serialized; the inline tree is a rendering cache computed lazily from it, and `serialize()` never looks at it.

The block layer's discipline applies one level down, and it's the rule to remember:

> **A marker in the DOM is `raw.slice(start, end)`, never a delimiter you printed because the node said "strong".**

That's what makes `textContent` equal `raw`, which is what makes cursor offsets mean something, which is what makes editing possible at all.

## 2. The loop

Every keystroke in an inline-bearing block runs the same short cycle:

```
input → read raw back from the DOM → write node.raw
      → re-parse the inline tree
      → rebuild the styled span tree
      → restore the cursor
```

Rebuilding the whole span tree per keystroke sounds wasteful, but it means there's no incremental DOM patching to get subtly wrong.

Reading `raw` back from the DOM is the step with a trap in it. **A prose block's `textContent` is not its `raw`**, for two independent reasons:

- **Atomic widgets contribute zero characters to `textContent`.** An image or an inline formula renders as a `contenteditable="false"` span whose bytes live on `data-source-*` attributes, not in any text node.
- **The ambient prefix contributes characters that aren't in `raw` at all.** A footnote definition lends its `[^label]: ` marker to its first prose child's rendered content, so `textContent === ambientPrefix + raw`, give or take the trailing line ending (§ The textContent invariant has the exact form).

The first one, with the entity widget (a decoded `&copy;` renders as one atomic glyph):

```ts
const raw = 'a &copy; b';
const div = document.createElement('div');
div.appendChild(
	renderInlineNodes(parseInline(raw, 0, raw.length), raw, { grammar: defaultGrammarView })
);
div.textContent; // 'a © b': the widget's six bytes are gone
rawTextOfNode(div, raw); // 'a &copy; b': the walk puts them back
```

So the read goes through that raw-aware DOM walk (`browser/offsets.ts`), which sums text-node lengths _and_ widget raw lengths, marker-span text included. Leaving the lent marker out is the walk's job too: `rawOffsetAt` reads the marker's length off the DOM and subtracts it, and `readContent` (`browser/block-text.ts`) skips the marker span. Surfaces with neither complication (code blocks, plain plugin leaves) can read `textContent` directly, because for them it genuinely is `raw`.

IME composition (typing through an input method, think Chinese or Japanese input) suppresses the rebuild until the composition ends. Blocks without inline support are untouched by any of this.

## 3. The inline node model

Same flat-interface philosophy as `CstNode`: discriminate on `kind`, no class hierarchy. `syntax-tree.md` § 4 has the full kind table.

Each node carries `start`/`end` byte offsets into the parent block's `raw`, covering its full range **including its markers**:

```ts
parseInline('**bold**', 0, 8);
// [{ kind: 'strong', start: 0, end: 8, children: [{ kind: 'text', start: 2, end: 6, text: 'bold' }] }]
```

Every character in the parsed range belongs to exactly one node. Nodes with children (emphasis, strong, strikethrough, link, image) nest recursively, and a wrapper's range spans its markers as well as its children, which is why the strong above runs 0 to 8 while its text runs 2 to 6.

### Coordinate spaces

Inline offsets live in **one** space: the prose block's own `raw`.

For a block inside a strip container (blockquote, list: a container whose syntax is a strippable per-line prefix), that `raw` is a slice of the container's **stripped inner buffer**. The parser strips the `> ` or the list marker before parsing children, so a child's `raw` never contains container syntax, and that's a different space from the container's `raw`, which keeps the prefix.

The two spaces are bridged **structurally**, not by any offset-rebasing function:

- **In** (parse): the container parser strips its prefix once, then parses children from the stripped buffer.
- **Out** (serialize): `rebuildRaw` re-applies the prefix. That's the strip-container invariant, `strip(raw) === serialize(children)`.

There's no function mapping an inline offset into a container's `raw`, because nothing needs one. Inline parsing, cursor offsets, and selection all work in the prose block's own `raw`.

The only _runtime_ coordinate translation is between the DOM and raw, and it lives in exactly one place: `browser/offsets.ts` reads a DOM position back as raw (`rawOffsetAt`), and the caret writer beside it (`browser/caret-writer.ts`) writes a caret at a raw offset (`placeCaretAtRaw`), lent marker included. Offset arithmetic done anywhere else will eventually disagree with it.

## 4. The parser

### Scope

The inline parser operates on the **content range** within a block's `raw`, the part between the block-level markers (after a heading's `## `, and before its closing `#` run if it has one). The range is whatever the kind registers as `contentStart.range`, so kind registration is the single source; a kind that declares none parses all of `raw`. Returned nodes carry offsets relative to the block's own `raw`, not to the content range:

```ts
const h = parse('## Title **x**\n').children[0];
getContentRange(h); // { start: 3, end: 14 }: past the `## `, before the line ending
computeInlineContent(h);
// [
//   { kind: 'text', start: 3, end: 9, text: 'Title ' },
//   { kind: 'strong', start: 9, end: 14, children: [{ kind: 'text', start: 11, end: 12, text: 'x' }] }
// ]
```

### Pipeline

A single left-to-right pass in the shape of commonmark.js, with a shortcut in front: one regex search for anything the parse might read (a construct's first character, a `www.` or `http://`, a registered plugin trigger). A span with none of those comes back as one text node without building any scan state, and that's the span most keystrokes land in.

```ts
parseInline('plain text', 0, 10); // [{ kind: 'text', start: 0, end: 10, text: 'plain text' }]
```

- **Handlers, then the built-in reading.** At each position the search stops on, the plugin handlers for that character are asked first, then the built-in reading runs. Leaves (code spans, escapes, entities, `<url>` autolinks, raw HTML, hard breaks, a handler's claim) become tokens, and the bytes between them stay pending text. The characters the parse reads itself are `BUILT_IN_TRIGGERS` in `core/inline/scan/plugin-syntax.ts`.
- **Delimiter stack.** `*` / `_` / `~~` runs are classified as opener or closer by the CommonMark flanking rules (the spec's test for whether a run can open or close emphasis) and pushed. Pairing waits for a `]` that makes a link, or the end of the span.
- **Bracket stack.** `[` and `![` push a candidate; `]` attempts an inline or reference link/image and, on success, pairs emphasis over the construct's interior. Links never contain links. Labels resolve exactly as CommonMark does first, and only a full or collapsed reference that CommonMark leaves literal becomes an `unresolvedReference` node (`[x][]` with no `[x]` defined, say). The label, destination and title are read by the grammar the block parser's link reference definitions use too (see [One grammar per construct](#one-grammar-per-construct), below).
- **Bare urls and emails** are read where they start, in the same pass. A bare autolink starts only after a GFM boundary, read off the source byte before it (so `<http://a.com>www.b.com` links just the first one), and runs to whitespace or `<`. It stops early only where another construct would take the bytes: a code span, an entity, an escape, a plugin handler's claim (so `https://a.co[^1]` keeps its footnote), or a `[` that may open a link. A bracket no link takes stays in the url, as on GitHub, so `https://example.com/search?tags[]=a` links whole. A delimiter inside a url never pairs.
- **The tree** is built at the end: emphasis pairs what's left on the delimiter stack, then one walk over the tokens nests the wrappers and joins touching text. The walk keeps its own stack, so 20,000 nested images don't reach the call stack.

**Precedence is positional.** The construct that completes earliest claims its bytes, and the scan never re-enters a claimed range, so code spans, autolinks, and raw HTML are mutually inert with no occupied-range bookkeeping. Sibling overlap is structurally unrepresentable rather than defended against, which is the nicest kind of bug to not have.

### One grammar per construct

A construct's syntax is read in one place, and the code that writes it back sits right beside that reader. Two copies of a grammar drift apart, and then the editor writes bytes its own parser reads differently.

- **Link labels, destinations and titles**: `core/inline/scan/link-grammar.ts`. Inline links, reference links and link reference definitions all read through it, so `[a](/u\*)` and `[a]: /u\*` both resolve to `/u*`. Each reader returns where its span ends (a destination also returns its processed value, escapes and entities resolved and percent-encoded), and a label or title that reaches the end of the text still open says so, so the definition reader can carry on into the next line. Labels match by `labelKey`, which collapses whitespace and case folds the way commonmark.js does (`[ẞ]` finds `[SS]`). The inverse is `core/inline/destination-bytes.ts`, which writes a destination or title that reads back as the same value.
- **Code spans**: `core/inline/scan/code-span.ts :: codeFenceWidth` gives the width of a span's backtick runs, for the renderer and for anything asking for the span's content range (the format toggle, say). `asCodeSpan` in the same file wraps text in a fence that reads back as that text.
- **Link and image edits**: the bytes the link card and the image controls (resize, crop, the popover) write come from `core/inline/link-source-bytes.ts` and `core/inline/image-source-bytes.ts`, next to the readers those bytes have to satisfy. An image's size hint is written by `core/inline/scan/size-hint.ts`, the same file that reads it.

### The plugin tier

A plugin owns a **single trigger character** and supplies a recognizer: given `raw` and a position, claim a range and return a node, or decline and leave the character as literal text. Registrations form a priority order, the inline mirror of the block layer's `OPENER_PRIORITIES`. Handlers on one trigger are consulted lowest-priority-first, so two plugins on the same character dispatch deterministically regardless of registration order.

```ts
INLINE_PRIORITIES; // { prefixOverride: 40, builtin: 50, plugin: 100 }

registerInlineSyntax('%', (raw, pos, end) => {
	const close = raw.indexOf('%', pos + 1);
	if (close === -1 || close >= end) return null; // decline: the `%` stays literal text
	return { kind: 'percent', start: pos, end: close + 1 };
});
parseInline('a %x% b', 0, 7);
// [
//   { kind: 'text', start: 0, end: 2, text: 'a ' },
//   { kind: 'percent', start: 2, end: 5 },
//   { kind: 'text', start: 5, end: 7, text: ' b' }
// ]
```

Whether a trigger can outrank a built-in depends on whether the parse reads that character itself (`BUILT_IN_TRIGGERS`, above):

- Any other character is free. A bare handler on it is asked wherever it appears, and the search above starts stopping on it the moment it's registered. That's the `%` above, and inline math, emoji shortcodes, and the inline `:name:` directive all ship this way.
- A **built-in** trigger (``\ ` & * _ ~ [ ] ! <`` and the newline) is reachable only through a multi-character **prefix handler** registered at a priority below the built-in boundary, which the parse asks _ahead_ of its own reading and only when the prefix matches at that position. Footnotes' `[^` beats `[` this way while a plain `[` still opens a link, and `![[…]]` outranks the image case the same way.
- A bare registration on a built-in trigger throws, rather than accepting a recognizer that could never fire. So does a prefix handler at a priority at or above the boundary, and any handler on `]`, which the parse only ever meets closing a `[`.

What those throws look like, so you recognize them when you meet one:

```ts
const recognizer = () => null;
registerInlineSyntax('[', recognizer);
// Error: registerInlineSyntax: trigger "[" is built in and needs a prefix
registerInlineSyntax('[', recognizer, { prefix: '[^', priority: 100 });
// Error: registerInlineSyntax: priority 100 on built-in trigger "[" is not below the built-in reading
registerInlineSyntax('%%', recognizer);
// Error: registerInlineSyntax: trigger "%%" is not one UTF-16 unit
```

The contract is deliberately narrow: a recognizer that returns a node not starting at the trigger, or that fails to advance, throws right there (`inline-syntax "^" returned a node starting at 3, not at its trigger 2`) rather than producing a tree with a gap or an overlap in its coverage.

### Separation from the block parser

The block parser never calls the inline parser. The editor layer triggers inline parsing after block parsing, because:

- Block parsing runs in contexts that never render (tree operations, tests) and shouldn't pay for inline work.
- Kind detection and rendering are separate concerns; coupling them would double-parse during editing.
- Link-reference resolution needs document-level context the block parser doesn't have.

## 5. Rendering

The renderer takes the inline node array **and the block's `raw`**, and produces a DOM fragment. It needs `raw` because that's where the markers come from (the rule in § 1), and it takes the editor's grammar too, so a plugin the editor leaves out never draws a widget. "Dim marker spans" below are spans holding a construct's own delimiters, sliced from `raw` and styled faint:

```ts
const raw = '**bold** and `code`';
renderInlineNodes(parseInline(raw, 0, raw.length), raw, { grammar: defaultGrammarView });
// <span class="md-marker">**</span><strong>bold</strong><span class="md-marker">**</span>
//  and <span class="md-marker">`</span><code class="inline-code-content">code</code><span class="md-marker">`</span>
```

| Kind                  | DOM output                                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | Text node                                                                                                                                                                                                                                                                  |
| `inlineCode`          | Dim marker spans around a `<code>` element holding the content                                                                                                                                                                                                             |
| `emphasis`            | Dim marker spans around `<em>` wrapping the children, rendered recursively                                                                                                                                                                                                 |
| `strong`              | Dim marker spans around `<strong>`                                                                                                                                                                                                                                         |
| `strikethrough`       | Dim marker spans around `<s>`                                                                                                                                                                                                                                              |
| `link`                | Markers sliced from `raw` around an `<a>` wrapping the children, when the resolved URL passes the scheme allowlist (only safe schemes, `https` and friends, get a live link). A blocked scheme renders an inert `span` instead: markers and text preserved, no live `href` |
| `autolink`            | The same policy: a live `<a>` for an allowlisted scheme, an inert span otherwise                                                                                                                                                                                           |
| `image`               | An atomic `<img>` widget, unless the kind opts out via `renderImagesAsWidgets` (table cells do, and fall back to alt text)                                                                                                                                                 |
| `hardLineBreak`       | Marker span for the `\` or the spaces, plus a `\n` **text node** (never a `<br>`)                                                                                                                                                                                          |
| `escape`              | Dim marker span for the `\`, plus a text node for the escaped character                                                                                                                                                                                                    |
| `entityReference`     | An atomic widget of the decoded glyph (`&copy;` → ©) when it renders visibly; a whitespace/control/zero-width decoding keeps a styled span over the `&…;` source, so no invisible atomic widget is created                                                                 |
| `unresolvedReference` | Styled span over the literal source of a reference with no matching definition                                                                                                                                                                                             |
| `rawHtml`             | Allowlisted tags (`<br>`) render as atomic widgets; everything else as a styled source span                                                                                                                                                                                |
| _plugin kinds_        | A registered widget (§ 6). Anything still unrecognized falls back to a `span.md-unknown-inline` holding its verbatim source, the inline mirror of the unknown-block fallback, so bytes survive a plugin being uninstalled                                                  |

A few rows, rendered (each fragment's `textContent` is its `raw`, which is the point):

```ts
'a\\\nb'; // a<span class="md-marker">\</span>\nb
'\\*'; // <span class="md-marker">\</span>*
'[x](javascript:alert(1))';
// <span class="md-marker">[</span><span class="md-link-content md-link-blocked">x</span>
// <span class="md-marker">]</span><span class="md-marker">(javascript:alert(1))</span>
'a &copy; b';
// a <span class="md-entity-widget" data-inline-widget="" data-source-start="2" data-source-end="8"
//   contenteditable="false">©</span> b
'a&nbsp;b'; // a<span class="md-entity">&amp;nbsp;</span>b
```

Hard line breaks use `\n` text nodes rather than `<br>`, because text nodes give the same `textContent` in every browser and `<br>` doesn't.

### The textContent invariant

**Every character in `raw` has a corresponding text node in the DOM, except atomic widgets.** For widget-free prose:

```
textContent === ambientPrefix + raw     (minus the trailing line ending)
```

where `ambientPrefix` is the read-only string a parent container lends its first prose child (a footnote definition's `[^label]: `; a list item draws its marker in a cell of its own, outside the text, so its blocks have none). Atomic widgets are the one exception, by design: they render as `[data-inline-widget]` `contenteditable="false"` elements with no `textContent`, carrying their bytes on `data-source-start` / `data-source-end` (the `&copy;` span above is one).

`[data-inline-widget]` is the generic marker the cursor walker, the selection painter, and the raw reader all key off, regardless of widget kind. Registering a new widget kind needs no plumbing in any of them.

## 6. Widget render paths

A plugin's widget kind draws through the `view` on its registration, a `PluginView`: a plain function the editor hands an element and some props, which fills the element and hands back an optional `update` and `destroy` (`src/lib/plugin-view.ts`). The render layer builds the span itself, stamped with `[data-inline-widget]`, the `data-source-*` offsets and `contenteditable="false"`, so no view can get those wrong. The view gets `{ inline, source }` plus live getters for the presentation mode, the theme, the root document and the content version, read per render since a view outlives a mode flip or an edit elsewhere. `svelteView` makes a view out of a Svelte component, and since a view is just a function, `core/` never learns what drew it.

The editor's own widgets (raw HTML, decoded entities, directive text) skip the view: an internal table maps each to a `draw` function that builds its span directly (`core/inline/inline-widgets.ts`), and plugins never see that table.

The editor rebuilds a block's whole inline DOM on every keystroke, so a plugin's views sit in a reuse pool keyed by kind and source text (`src/lib/components/blocks/widget-portal.ts`). Typing next to a rendered formula keeps its view and hands it the moved `inline` through `update`; editing the formula itself mounts a new one. A view that throws is reported on the editor's `error` channel, and its widget falls back to the raw source span.

The editing behavior of a widget (reveal-to-edit, select-then-delete, or atomic step-over, what its keys do while selected, and what a press on the rendered widget does) is a per-kind **editing policy** on the same registry. `editor.md` § Atomic inline widgets covers the caret model those policies drive.
