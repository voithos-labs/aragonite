# Inline Parsing — Design Spec

## 1. What this is

Block parsing gets you as far as "this is a paragraph". Inline parsing is what turns the text _inside_ it into styled DOM: `**bold**` renders bold, with the `**` still visible and dimmed.

It runs on every kind that declares `supportsInline` on its descriptor: paragraphs, headings, setext headings, and table cells. Cells run the identical pipeline; they just have no ambient prefix and no block marker to skip.

**The inline tree is derived, and disposable.** `raw` is still the source of truth (`syntax-tree.md` § 1); the inline tree is a rendering cache computed lazily from it, and `serialize()` never looks at it. If the inline parser has a bug, the worst case is wrong styling. It cannot lose data.

The same discipline as the block layer applies one level down, and it is the rule to remember:

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

The span structure is therefore always correct, because it is rebuilt after every character. Rebuilding the whole thing on every keystroke sounds wasteful, and it buys the property that matters: there is no incremental DOM patching to get subtly wrong.

Reading `raw` back from the DOM is the step with a trap in it. **A prose block's `textContent` is not its `raw`**, for two independent reasons:

- **Atomic widgets contribute zero characters to `textContent`.** An image or an inline formula renders as a `contenteditable="false"` island whose bytes live on `data-source-*` attributes, not in any text node.
- **The ambient prefix contributes characters that aren't in `raw` at all.** A list item lends its `- ` marker to its first prose child's rendered content, so `textContent === ambientPrefix + raw`.

So the read goes through a raw-aware DOM walk (`cursor/widget-offset.ts`), which sums text-node lengths _and_ widget raw lengths, marker-span text included. Excluding the marker is the wrapper's job: the raw read skips the ambient span, and `ambient/ambient-cursor.ts` subtracts its length from offsets. Surfaces with neither complication (code blocks, plain plugin leaves) can read `textContent` directly, because for them it genuinely is `raw`.

IME composition suppresses the rebuild until composition ends; blocks without inline support are untouched by any of this.

## 3. The inline node model

Same flat-interface philosophy as `CstNode`: discriminate on `kind`, no class hierarchy. `syntax-tree.md` § 4 has the full kind table.

Each node carries `start`/`end` byte offsets into the parent block's `raw`, covering its full range **including its markers**. Every character in the parsed range belongs to exactly one node. Nodes with children (emphasis, strong, strikethrough, link, image) nest recursively, and a wrapper's range spans its markers as well as its children.

### Coordinate spaces

Inline offsets live in **one** space: the prose block's own `raw`.

For a block inside a strip container, that `raw` is a slice of the container's **stripped inner buffer**, because the parser strips the `> ` or the list marker before parsing children, so a child's `raw` never contains container syntax. That is a different space from the container's `raw`, which keeps the prefix.

The two spaces are bridged **structurally**, not by any offset-rebasing function:

- **In** (parse): the container parser strips its prefix once, then parses children from the stripped buffer.
- **Out** (serialize): `rebuildRaw` re-applies the prefix. That is the strip-container invariant, `strip(raw) === serialize(children)`.

There is no function mapping an inline offset into a container's `raw`, because nothing needs one. Inline parsing, cursor offsets, and selection all work in the prose block's own `raw`.

The only _runtime_ coordinate translation is DOM ↔ raw, and it has exactly one home: `cursor/widget-offset.ts`, wrapped by `ambient/ambient-cursor.ts` for the marker prefix. Offset arithmetic done anywhere else will eventually disagree with it. Not a hypothetical: every offset bug in the 2026-07 audit traced to arithmetic outside the shared walk (`contributing/casebook.md`).

## 4. The parser

### Scope

The inline parser operates on the **content range** within a block's `raw`, the part after the block-level markers (after `## ` for a heading). The range comes from the descriptor's `getContentRange` hook, so kind registration is the single source. Returned nodes carry offsets relative to that block's own `raw`, not to the content range.

### Pipeline

A single left-to-right scan, the commonmark.js reference architecture, fronted by a **plain-text fast bail**: content containing no construct-starting character short-circuits to one text node, which keeps the per-keystroke hot path O(n) with no allocation. (The bail also probes the plugin trigger registry, but only when something is registered; an empty registry leaves the scan byte-identical to the built-in grammar.)

- **Character dispatch.** Each construct-starting character runs its handler; handlers append completed nodes (code spans, escapes, entities, spec autolinks, raw HTML, hard breaks) and advance the scan. Unclaimed bytes accumulate as pending text.
- **Delimiter stack.** `*` / `_` / `~~` runs are classified as opener or closer by the CommonMark flanking rules and pushed. Pairing is deferred.
- **Bracket stack.** `[` and `![` push a candidate; `]` attempts an inline or reference link/image and, on success, pairs emphasis over the construct's interior. Links never contain links. A reference-form label with no matching definition commits to an `unresolvedReference` node rather than falling apart.
- **Deferred passes.** GFM bare autolinks claim maximal text runs (a delimiter absorbed into a URL can never pair), then emphasis pairing consumes the remaining delimiter stack, then adjacent text nodes merge.

**Precedence is positional.** The construct that completes earliest claims its bytes, and the scan never re-enters a claimed range, so code spans, autolinks, and raw HTML are mutually inert with no occupied-range bookkeeping. Sibling overlap is structurally unrepresentable rather than defended against, which is the nicest kind of bug to not have.

### The plugin tier

A plugin owns a **single trigger character** and supplies a recognizer: given `raw` and a position, claim a range and return a node, or decline and leave the character as literal text. Registrations form a priority ladder, the inline mirror of the block layer's `OPENER_PRIORITIES`: rungs on one trigger are consulted lowest-priority-first, so two plugins on the same character dispatch deterministically regardless of registration order.

Whether a trigger can outrank a built-in depends on which side of the scanner's switch it falls. A character the switch claims no `case` for dispatches from the **default arm**, after every built-in construct. A **reserved** trigger, one the switch owns, is reachable only through a multi-character **prefix rung** priced below the built-in boundary, which the scanner consults _ahead_ of its switch and only when the prefix matches at the cursor; footnotes' `[^` beats `[` this way while a plain `[` still opens a link. A bare registration on a reserved trigger throws rather than accepting a recognizer that could never fire, and so does a prefix rung on a trigger the scanner's fast bail never visits in plain text, unless the trigger is one the bail **probes on demand**, which `!` is: a registration there turns the probe on for that character, so `![[…]]` can outrank the image case without making every prose `!` unconditionally special.

The seam is deliberately narrow: a recognizer that returns a node not starting at the trigger, or that fails to advance, throws at the seam rather than producing a tree with a gap or an overlap in its coverage. Inline math, emoji shortcodes, and the inline `:name:` directive ship on unreserved triggers; footnote references ship on a reserved-trigger prefix rung.

### Separation from the block parser

The block parser never calls the inline parser. The editor layer triggers inline parsing after block parsing, because:

- Block parsing runs in contexts that never render (tree operations, tests) and shouldn't pay for inline work.
- Kind detection and rendering are separate concerns; coupling them would double-parse during editing.
- Link-reference resolution needs document-level context the block parser doesn't have.

## 5. Rendering

The renderer takes the inline node array **and the block's `raw`**, and produces a DOM fragment. It needs `raw` because that's where the markers come from (see the rule in § 1).

| Kind                  | DOM output                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `text`                | Text node                                                                                                                                                                                                                      |
| `inlineCode`          | Dim marker spans around a `<code>` element holding the content                                                                                                                                                                 |
| `emphasis`            | Dim marker spans around `<em>` wrapping recursive children                                                                                                                                                                     |
| `strong`              | Dim marker spans around `<strong>`                                                                                                                                                                                             |
| `strikethrough`       | Dim marker spans around `<s>`                                                                                                                                                                                                  |
| `link`                | Markers sliced from `raw` around an `<a>` wrapping recursive children — when the resolved URL passes the scheme allowlist. A blocked scheme renders an inert `span` instead: markers and text preserved, no live `href`        |
| `autolink`            | The same policy: a live `<a>` for an allowlisted scheme, an inert span otherwise                                                                                                                                               |
| `image`               | An atomic `<img>` widget — unless the kind opts out via `renderImagesAsWidgets` (table cells fall back to alt text)                                                                                                            |
| `hardLineBreak`       | Marker span for the `\` or the spaces, plus a `\n` **text node** (never a `<br>`)                                                                                                                                              |
| `escape`              | Dim marker span for the `\`, plus a text node for the escaped character                                                                                                                                                        |
| `entityReference`     | An atomic widget of the decoded glyph (`&copy;` → ©) when it renders visibly; a whitespace/control/zero-width decoding keeps a styled span over the `&…;` source, so no invisible atomic island is created                     |
| `unresolvedReference` | Styled span over the literal source of a reference with no matching definition                                                                                                                                                 |
| `rawHtml`             | Allowlisted tags (`<br>`) render as atomic widgets; everything else as a styled source span                                                                                                                                    |
| _plugin kinds_        | A registered widget (see § 6). Anything still unrecognized falls back to a `span.md-unknown-inline` holding its verbatim source — the inline mirror of the unknown-block fallback, so bytes survive a plugin being uninstalled |

Two design rules the table depends on:

- **Marker text is always sliced from `raw`, never reconstructed from parsed fields.** This is what guarantees `textContent` matches `raw` regardless of the original syntax's spacing or delimiter choice.
- **Hard line breaks use `\n` text nodes, not `<br>`.** Text nodes produce consistent `textContent` across browsers; `<br>` does not.

### The textContent invariant

**Every character in `raw` has a corresponding text node in the DOM, except atomic widgets.** For widget-free prose:

```
textContent === ambientPrefix + raw     (minus the trailing line ending)
```

where `ambientPrefix` is the read-only string a parent container lends its first prose child (a list item's `- `). Atomic widgets are the one exception, by design: they render as `[data-inline-widget]` `contenteditable="false"` elements with no `textContent`, carrying their bytes on `data-source-start` / `data-source-end`.

`[data-inline-widget]` is the generic marker the cursor walker, the selection painter, and the raw reader all key off, regardless of widget kind. Registering a new widget kind requires no plumbing in any of them.

## 6. Widget render paths

A widget kind renders one of two ways.

- **Component (recommended).** The kind supplies a Svelte component. The render layer builds the atomic island itself (stamping `[data-inline-widget]`, the `data-source-*` offsets, and `contenteditable="false"`) and mounts the component inside with a frozen `{ inline, source }` snapshot. Beside it ride live getters for the presentation mode, the theme, the root document, and the content version: a pooled instance survives a mode flip and an edit elsewhere, so those are read per render rather than captured at mount. A table cell mounts through the same path, threading mode and theme as a prose block does, and a mode flip rebuilds a cell's inline DOM the same way. Mounting is _injected_ into the core layer, so `core/` stays framework-free: the registry records only that a kind is a component widget, never how to mount one.
- **Hand-built.** The kind emits its own DOM root and must carry those same attributes itself.

Because the editor rebuilds a block's entire inline DOM on every keystroke, component widgets ride a **keyed reuse pool**. An instance is keyed by kind and source text, so a rebuild _adopts_ an unchanged instance, re-stamping only its shifted `data-source-*` offsets, instead of remounting it. Typing next to a rendered formula keeps its mount, and its render cost, stable; editing the formula mints a new one. An instance left unadopted at the end of a pass is torn down, and a mount that throws is caught, reported on the editor's `error` channel, and falls back to the raw source span.

The editing behavior of a widget (reveal-to-edit, select-then-delete, or atomic step-over, and what its keys do while selected) is a per-kind **editing policy** on the same registry. `editor.md` § Atomic inline widgets covers the caret model those policies drive.
