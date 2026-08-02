# Editor Consumer Guide

How to embed, theme, and wire the editor as a library. Extending it with your own block or inline content instead? That's the [plugin author guide](plugin-guide.md).

## What you are embedding

aragonite is a Markdown editor you mount as a Svelte component. You hand it Markdown; you read Markdown back. There is no intermediate document format to convert into and out of — the raw source **is** the document, and `serialize(parse(source)) === source` holds for every valid GFM file. What you save is what the user authored, byte for byte.

That one fact explains most of the API:

```
  your app                          <Editor>
  ────────                          ────────
  source ─────── mount ───────────▶ parse ─▶ CST ─▶ contenteditable
                                                        │ user edits
  getSource() ◀── serialize ◀──────────────────────────┤
  getEvents() ◀── edit / selectionChange / error ───────┘
```

The editor owns the caret, the tree, and the undo stack. **You own load, save, and dirty state.** There is no `bind:source`, no autosave, and no persistence layer hiding behind the component — if you want the document on disk, you call `getSource()` and write it.

## The five things to know

1. **`source` seeds the document at mount**, and re-seeds it if the prop later changes. It is not two-way bound.
2. **`bind:this` is the instance surface** — `getSource()`, `getSelection()`, `getEvents()`, `getSearch()`, `getRects()`, `getDecorations()`, `getDiagnostics()` read; `setSelection()` is the one that writes.
3. **Theming is CSS custom properties** on the editor's own root. Nothing lands on `:root`.
4. **Plugins are process-global**, installed once at mount. Two editors share one grammar, never any state.
5. **`editor.__test.*` is not part of the contract.** It is internal and will move.

### Mount example

```svelte
<script>
	import { Editor } from 'aragonite';
	import 'aragonite/styles/editor-theme.css';

	let editor;
</script>

<Editor bind:this={editor} source={'# Hello\n'} theme="dark" />
<button onclick={() => save(editor.getSource())}>Save</button>
```

## Public API

Everything supported is re-exported from the package barrel (`aragonite`). Adding an export is non-breaking; removing one is breaking — so the surface is kept small and grows on demand. The barrel itself (`src/lib/index.ts`) is the authoritative list; this is the map.

| Group                  | What you get                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Component**          | `Editor`, plus `EditorProps` and `EditorInstance` — the prop shape and the `bind:this` surface                                                                                                                                                                                                                                                   |
| **Policy types**       | `ResolveImageUrl`, `ResolveLinkUrl`, `ImageLoadPolicy` — the types the behavior props reference; `PastedImage` and `PasteImageHook` for the image-import hook                                                                                                                                                                                    |
| **Plugins**            | `installPlugins` for an editor-less pipeline; `EditorPlugin` (the unit) and `EditorPluginEntry` (a `plugins` entry — a bare unit or `{ plugin, options }` for per-instance options)                                                                                                                                                              |
| **Selection + keymap** | `EditorSelection` (what `getSelection()` returns), `KeybindingOverride` and `CommandId` (what the `keybindings` prop takes)                                                                                                                                                                                                                      |
| **Search**             | `SearchState`, `SearchOptions`, `Match` — the find/replace controller, its options, and one hit                                                                                                                                                                                                                                                  |
| **Decorations**        | `DecorationRegistry` and the decoration types — what `getDecorations()` returns (see [Decorations and rects](#decorations-and-rects))                                                                                                                                                                                                            |
| **Rects**              | `EditorRects` — what `getRects()` returns: viewport-space geometry over the rendered document                                                                                                                                                                                                                                                    |
| **CST utilities**      | `parse` / `serialize` for round-tripping Markdown outside the component; `parseInline`, `getContentRange`, `isProseKind` for inspecting a block's inline content and editable range                                                                                                                                                              |
| **Node types**         | `CstNode`, `Document`, the block-kind and inline-node unions, and the per-kind metadata shapes — the vocabulary for reading a parsed document. `NodeView` / `DocumentView` are their bytes-readonly views: every editor surface that hands you a node to read types it as a view, so mutating the live tree is a compile error, not a convention |
| **Events**             | `EditorEvents` and the payload types the observer surface emits                                                                                                                                                                                                                                                                                  |
| **Diagnostics**        | `EditorDiagnostics` (what `getDiagnostics()` returns) and `InteractionTraceEntry` — the field-report door (see [Diagnostics](#diagnostics))                                                                                                                                                                                                      |

### The component contract

`<Editor>` is controlled-by-prop-at-mount, read imperatively.

- **`source`** is read once at mount. An internal effect re-syncs the document if the prop changes; there is no two-way binding.
- **`bind:this`** exposes ten methods:
  - **`getSource()`** — serialize the live document back to Markdown.
  - **`getSelection()`** — a frozen snapshot of the current selection, or `null` when nothing is focused. Path arrays are copies. Each endpoint (`SelectionPoint`) is a discriminated union: `offset` is a character index into the block, unless `cellCoordinate: true` marks it a table cell index — narrow on the flag before reading `offset` as a character offset.
  - **`setSelection(snapshot)`** — put a `getSelection()` snapshot back on the document (see [Restoring a selection](#restoring-a-selection)).
  - **`getEvents()`** — the observer surface (see [Events](#events)).
  - **`getSearch()`** — the find/replace controller (see [Search](#search)).
  - **`getRects()`** — viewport-space geometry over the rendered document (see [Decorations and rects](#decorations-and-rects)).
  - **`getDecorations()`** — register a view-only annotation source, no plugin needed (same section).
  - **`getDiagnostics()`** — the field-report door: arm the interaction trace and serialize an attachable bug report (see [Diagnostics](#diagnostics)).
  - **`reservedChords()`** / **`claimsChord(event)`** — which modifier chords this instance consumes (see [Which shortcuts the editor consumes](#which-shortcuts-the-editor-consumes)).

### Restoring a selection

`setSelection(snapshot)` takes what `getSelection()` gave you and puts it back — the other half of a save-and-restore pair, for a host that persists a per-document caret or re-seeds the selection after swapping `source`.

It is async, and deliberately: the target may be a block the virtual window has unmounted, so the restore reveals it and scrolls it in before placing the caret. The boolean is honest the same way `scrollTo`'s is — `true` means placed **and** in view.

- **`false` never throws, and covers three shapes.** A path that no longer addresses a block is declined up front with no side effect at all — no scroll, no focus steal, no state write. A path that resolves in the tree but whose element is absent from the DOM has already scrolled, and re-established cross-block state, by the time placement fails. And a placement that lands while the scroll cannot settle the target into view also reports `false`, because the boolean promises in view rather than merely placed. Since 0.9.36 that third shape has one more trigger: a **later programmatic reveal** — your own `scrollTo`/`navigateTo`, or the find bar navigating — issued before this restore settles takes the viewport, and the restore stops competing for it rather than fighting the newer target. An ordinary user gesture is not that case; typing, clicking or scrolling while a restore settles leaves the outcome exactly as it was before. **The caret is placed either way in this third shape**, so branch on it as "the viewport did not end up where I asked", not as "nothing happened" — re-placing a fallback selection here would discard a caret that landed correctly.
- **Out-of-range offsets clamp, each in its own coordinate space.** A character offset clamps to the block's source length; an endpoint addressing a table clamps to the last cell, so a huge offset there becomes the bottom-right cell rather than a character position.
- **When the restore lands, every `selectionChange` it emits carries the restored selection.** The editor holds the channel until the state write and the caret landing have both happened, so a handler that treats the first event as authoritative — a persist-on-change host, say — saves the right one. The browser's own `selectionchange` may still deliver a trailing duplicate of that same value, so make the handler idempotent rather than counting events. Reading back with `getSelection()` after the await is still correct, and no longer necessary. **The exception is the `false` outcome above where placement fails:** a collapsed or within-block restore into a resolvable-but-unmounted block clears the old selection and then finds no element, so its one emission reports what was there before. Treat a `false` restore as "read the selection back", not as an authoritative event.

## Behavior / policy props

Optional props customize URL and image handling and the editor's affordances.

| Prop               | Effect                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveImageUrl`  | Rewrite a raw image URL before it reaches `img.src` (resolve a relative path, say)                                                        |
| `resolveLinkUrl`   | Rewrite a raw link href at render time                                                                                                    |
| `imageLoadPolicy`  | `auto` (load images) or `placeholder` (defer loading)                                                                                     |
| `onLinkActivate`   | Handle a link click (Ctrl/Cmd+click or activation); replaces the default `window.open`                                                    |
| `onPasteImage`     | Import hook for an image-bearing paste — return the Markdown to insert (see [Image paste](#image-paste))                                  |
| `header`           | Host chrome rendered inside the scroll container, above the first block (see [The header slot](#the-header-slot))                         |
| `scrollMode`       | `'self'` (default — the editor owns its scrollport) or `'host'` (an ancestor scrolls it; see [Host scroll mode](#host-scroll-mode))       |
| `blockDragHandles` | Toggle the mouse-only hover drag handle (default on); keyboard reorder (Alt+Arrow) is always available                                    |
| `searchBar`        | Toggle the in-document find/replace bar and its Ctrl+F / Ctrl+H shortcuts (default on)                                                    |
| `searchBarAnchor`  | An element to render that same bar into, instead of inside the editor root (see [Where the find bar lives](#where-the-find-bar-lives))    |
| `theme`            | Theme name reflected to `data-editor-theme` on the editor root; `'dark'` (default), `'light'`, or a custom name (see [Theming](#theming)) |
| `presentationMode` | `'source'` (default), `'reading'`, or a `preview-*` rung (see [Presentation modes](#presentation-modes))                                  |
| `keybindings`      | Per-instance keymap overrides — rebind or disable a chord (see [Keyboard shortcuts](#keyboard-shortcuts))                                 |
| `plugins`          | Plugin units installed once at mount, in array order, before the first parse (see [Plugins](#plugins))                                    |

**Set-once at mount** — `resolveImageUrl`, `resolveLinkUrl`, `imageLoadPolicy`, `onLinkActivate`, `onPasteImage`, `blockDragHandles`, `scrollMode`, and `plugins`. They thread to the renderer through context, and a post-mount swap is not guaranteed to re-render already-built blocks; set them at mount and treat them as fixed for the editor's lifetime. Two are sharper than the rest. A block reads `onPasteImage` when it mounts, and under virtual rendering blocks mount lazily — so a mid-session swap can leave different blocks holding different hooks. `scrollMode` is snapshotted outright, deliberately: reading it live would make the editor's hottest path depend on it.

`theme`, `searchBar`, `searchBarAnchor`, `presentationMode`, and `keybindings` read live and may change after mount, and `header` re-renders like any other snippet.

## Image paste

`onPasteImage` is the import hook for a paste carrying image files. The editor hands you each image; you store it however your app stores assets and return the Markdown that stands in for it — a wiki-style embed, a URL, whatever your `resolveImageUrl` understands. Return `null` to skip that image.

**Installing the hook takes the whole paste.** The clipboard's `text/plain` is not pasted alongside it, and with no hook installed an image-bearing paste behaves exactly as it does in an editor with no image support at all.

- **Once per image, in clipboard order, one insertion.** The images are offered sequentially and what they return is inserted as a single edit — one paste gesture is one undo entry, so a single Ctrl+Z takes the whole thing back.
- **Failure is skip-and-continue.** A hook that rejects on one image surfaces on the `error` channel with `origin: 'clipboard'` — the origin for any contained failure on the paste route, whether the paste consumed the gesture and inserted nothing or a single import threw while the rest of it landed — and the remaining images still land. A hook that answers `null` for every image still consumes the paste; there is no `text/plain` waiting behind it.
- **The paste replaces the selection it lands on**, within a block and across blocks alike, matching every other paste route. The deletion runs only after your hook has answered, so a declined or failed import destroys nothing.
- **A surface can disappear mid-import.** If the block the paste fired from is unmounted before a slow hook resolves, the insertion is declined on the `error` channel — the same `clipboard` origin — rather than dropping Markdown at a position the user never pointed at.

**Where the Markdown lands, when the user moves during the upload.** The two branches differ, and the difference is deliberate. An intra-block paste freezes its anchor at paste time: a caret moved while the upload is in flight does not drag the insertion with it. A cross-block paste follows the live selection instead, because that route resolves its endpoints by path at insertion time — so a selection _extended_ during the import is the selection that gets replaced. Snapshotting the second case would mean fighting the seam that owns delete-and-insert as one operation.

## Presentation modes

`presentationMode` selects how the document presents, live-switchable like `theme`:

- **`'source'`** (default) — always-visible styled source: every Markdown marker renders, dimmed, and everything is editable. Byte-identical to the editor's behavior before the prop existed.
- **`'reading'`** — a rendered reading view. Markers are hidden (by CSS — the document and its coordinate space are untouched), widgets render, list bullets and numbers show as rendered chrome, and the mode **writes no bytes**: typing, paste, cut, Enter/Backspace, undo/redo, block commands, checkbox toggles, drag handles, and table structure edits are all inert. What stays live is everything a reader needs — text selection, copy (which yields the rendered text, markers excluded), scrolling, search (find, not replace), and links, which activate on plain click since there is no caret to place. Navigation is by mouse (see the note below) — the read-only surface has no keyboard caret to traverse with.

  One affordance is live because it is not an edit: a **`<details>` disclosure toggles transiently**, so a reader can open a collapsed section and actually read it. The flip is view state — the source stays byte-identical, no `edit` event fires, nothing lands on the undo stack — and it is discarded on leaving the mode, where the document's own `open` state is the only truth again. A task checkbox stays inert by contrast, because toggling one WOULD rewrite the document.

- **`'preview-block'`** — block-granular live preview, a **fully live editing** mode. Every block hides its markers (the reading look) except the one holding the caret, which shows its full styled source; type, split, merge, select, undo, and search all work exactly as in source mode. The containment rule is: **only the single focused leaf shows source** — container chrome (a blockquote's border, a directive's gutter) is not markers and never toggles, and a focused list item shows its own bullet/number as source while sibling items stay rendered. Hiding is CSS keyed on which block is focused, so the marker DOM stays intact and a click lands the caret at the content it hit (the markers reveal around it without shifting it).
- **`'preview-inline'`** — inline-granular live preview, the Obsidian-style default: **the element under the cursor shows its syntax**. Unfocused blocks look exactly like `preview-block`; inside the focused block, each inline construct (bold, italic, strikethrough, inline code, links, image alt syntax) keeps its markers hidden until the caret enters it — arrowing or clicking into `**bold**` reveals the `**`s around the caret, and leaving folds them back. Nested constructs reveal their whole enclosing chain, so the syntax you are editing is always fully visible. A revealed construct is ordinary source text: typing, undo, and round-trip behave exactly as in source mode. Whole-block syntax (a heading's `## `, code fences) shows whenever its block is focused, as in `preview-block`; tables reveal per focused table rather than per construct.

  **Caret behavior (affinity).** The caret is a raw offset and a revealed construct's source is visible, so typing always lands exactly where the caret shows — there is no hidden-cursor affinity to reason about. Where two constructs meet at one boundary (`**a***b*`) both reveal and a keystroke inserts between them; a leftward walk into a construct's opening markers reaches them (`Home` lands at the first _visible_ position, just inside). Two edges to know: a focused list item keeps its bullet or number as rendered chrome here (`preview-block` instead shows it as source), and escapes (`\`) and hard line breaks reveal whenever their block is focused rather than by caret proximity.

The effective mode is reflected as `data-presentation` on the editor root — **absent** in source mode, so default-mode DOM is unchanged — and announced to subscribers as a `presentationModeChange` event on `getEvents()`.

One reading-mode limitation to know: blocks are not `contenteditable` there, so there is no within-block text caret — navigation is block-level (mouse selection and copy work natively on the static content). This is the same contract as other reading views (Obsidian's reading mode has no caret either).

## Embedding in a host layout

Two props decide how the editor sits inside your page: who owns the scroll, and what chrome rides above the document.

### Host scroll mode

By default the editor root **is** the scrollport. It owns its scroll position, and virtual rendering keeps the mounted block count proportional to the viewport rather than to the document — which is what lets it hold a large file at all. `scrollMode='host'` is the embedded alternative: the root stops scrolling and grows to its content, and an ancestor of yours scrolls it. A shell that stacks several documents in one scroller (a journal, a comment thread) wants this; a whole-file editor does not.

**The trade is explicit — host mode forfeits O(viewport).** Windowing never activates there and every block stays mounted, because a scope cannot window against a scrollport it neither owns nor may write. Use it for small embedded documents and keep `'self'` for anything a user will grow without limit.

What the host's own CSS has to provide:

- **Resolve the scroller before the editor's first use.** The editor finds the ancestor that scrolls it once, at first need. A shell that swaps its scroller in afterwards — a panel that expands, a wrapper replaced on a route transition — leaves the editor measuring against the wrong box. Settle the layout first, or remount the editor.
- **A clipping wrapper needs left padding.** Host mode drops the editor's own padding, and the hover drag handle sits in a gutter outside the block box. A wrapper with `overflow: hidden` and no padding clips the handle away entirely, so mouse drag-reorder silently disappears — reserve at least `0.85rem` on the left. Keyboard reorder (Alt+Arrow) is unaffected.
- **A drag autoscrolls whatever actually scrolls.** That is the nearest ancestor you made scrollable, or the page's own viewport when nothing between the editor and the document scrolls. One box it will never scroll is a fixed-height `overflow: hidden` wrapper: a reader cannot wheel one back, so a drag that scrolled it would strand content out of reach. Reveal does move such a box, deliberately — it can put the block on screen and leave it there.

The root reflects a `data-scroll-mode` attribute in host mode. **Treat it as an implementation detail, not contract** — it may start being emitted in self mode too. Style host-mode embeddings through your own wrapper elements, which you control; the mode's own layout rules are already scoped to the editor.

### The header slot

`header` is a snippet rendered **inside** the scroll container, above the first block: a document title, a properties panel, a tag row — chrome that belongs to the document rather than to the app frame. It scrolls away with the document instead of pinning above it, and that is exactly what lets the editor keep its own scrollport, and with it virtual rendering. Chrome mounted outside the editor would need an outer scroller and forfeit both.

- **The content is yours.** Links inside the slot follow your page's behavior rather than the editor's plain-click-edits policy, and a text field in the slot keeps its own keystrokes — `Mod+F` in a host title field opens your find, not the editor's.
- **Height changes do not slide the document.** A slot that grows or shrinks while the reader is scrolled down is compensated, so the block they were reading stays where it was. At the top of the document, growth pushes content down — which is what a reader looking at the header expects. In host mode the shift is left to the page: an embedded editor never writes an ancestor's scroll position.
- **The find bar overlays the slot's top strip.** The bar rides the editor's top edge in both modes — one rule, one mount site. In self mode that means it covers the header only at the very top of the scroll; in host mode, where the root never scrolls, it covers it whenever the bar is open.
- **A header taller than the viewport degrades gracefully.** At the top of the scroll it leaves the block list no room to intersect the viewport, so almost nothing mounts until the reader scrolls past it. Accepted rather than special-cased — a header that tall is a layout the slot is not for.

### Where the find bar lives

By default the bar pins to the editor root's top edge. In self-scroll mode that reads as a document's own find bar, which is what it is. In host-scroll mode the root is a box partway down someone else's page, so the bar rides that box: it sits mid-page and scrolls out of sight with the document it searches, while the pane's own chrome — where a reader expects a find field — stays empty.

`searchBarAnchor` fixes that without giving up the bar. Hand it an element and the editor renders the same bar into it. Everything else stays the editor's: the component, `Mod+F` / `Mod+H`, Esc, the match navigation, and the caret restore that puts the cursor back where the search started. Only the DOM position moves.

```svelte
<div class="pane-chrome" bind:this={findBarSlot}></div>
<div class="pane-body">
	<Editor {source} scrollMode="host" searchBarAnchor={findBarSlot} />
</div>
```

- **The prop reads live.** `null` or `undefined` puts the bar back in the editor root, so an anchor that mounts with a panel and unmounts with it is fine. It has no effect while `searchBar` is `false` — that switch turns the whole feature off, chords included.
- **Placement inside the anchor is yours.** The editor treats the element as the box and exports no positioning knobs. The bar positions itself absolutely, so give the anchor `position: relative` (or another positioned ancestor) and size it; otherwise the bar resolves against whatever the page's layout offers next.
- **The bar brings its own theme scope.** Custom properties resolve by DOM ancestry, so an anchor outside the editor would otherwise strip the bar's colors down to its fallbacks. The relocated node carries the `.aragonite-editor-theme` class and the effective `data-editor-theme`, and both track a `theme` change live — you do not need to theme the anchor yourself.

## Embedding in a webview shell

A desktop shell (Tauri/wry, WebView2, Electron) runs the editor on the same engine a browser does, so nothing about the component changes. What changes is the layer above it: the shell decides which keystrokes reach the page, and which URLs resolve to a local file. The seams below are the ones a browser-driven test run cannot observe, so treat each as something to verify in the built application rather than infer from a green CI run. Layout is the other half of embedding and is not shell-specific; [Embedding in a host layout](#embedding-in-a-host-layout) covers it.

### Chords the shell may claim

Which chords reach the page, and whether the shell or the document gets first refusal, is shell-specific. Where the shell resolves its accelerator first, the chord is consumed before any `keydown` reaches the document: the editor cannot bind it, observe it, or report that it went missing, and no `keybindings` override reaches a key that never arrives. Where the shell dispatches to the page first, the editor sees the chord and a capture-phase `preventDefault()` suppresses the shell's own action. Tauri/wry on WebView2 measures as the second kind, with reload and the devtools chords all arriving at the document and their defaults preventable. Assume neither arrangement; measure yours.

- **Verify the chord map in the real shell.** A browser run proves the keymap resolves, not that the chord arrives. Walk the [shortcut table](#keyboard-shortcuts) and your own app's bindings in the built application, on every platform you ship. Derive the editor's half of that walk from [`reservedChords()`](#which-shortcuts-the-editor-consumes) rather than copying the table, so it cannot go stale between releases.
- **A webview's zoom hotkeys may well be off already.** A zoom control driving `--editor-font-size` (see [Theming](#theming)) reaches for exactly the chords a webview is most likely to reserve, which makes it this section's bellwether. The collision is not a foregone conclusion, though: Tauri's zoom-hotkey option defaults to off, so on that shell `Mod+=` and `Mod+-` arrive at the page untouched and a host zoom control bound to them works. Measure before designing around a collision, and equally before assuming there is none.
- **A chord's fate can differ between your debug build and your shipped one.** Tauri enables the web inspector by default in debug builds and gates it behind a feature flag in release builds, so `F12` opens devtools while you develop and finds nothing to open in what you ship. Measure in the build you ship, not the one you iterate in.
- **The host's switches are coarse; the page's is fine.** A shell exposes a switch over a whole built-in accelerator family rather than a per-chord list, and there can be more than one family with its own default (Tauri splits page zoom out from the rest and defaults it off), so "the shell's accelerators" is rarely one setting. Where the shell dispatches to the page first, a capture-phase `preventDefault()` is the per-chord route its configuration does not offer. Check your shell's current documentation for what each switch covers.
- **A capture-phase key listener of your own needs an "inside the editor" guard.** A host that handles keys on `window` or `document` before the page sees them has to decline the ones headed for the editor, and the test is containment in the element you mounted `<Editor>` into (its root carries the `.editor` class). A guard inherited from a previously embedded editor keys off a selector that now matches nothing, which reads as "never inside the editor" and quietly swallows every editing chord.

### Which shortcuts the editor consumes

An app that registers its own accelerators needs to know what the document already claims. Ask the editor rather than keeping a copy:

- **`editor.reservedChords()`** returns a `ReadonlySet<string>` of normalized chord strings — every modifier chord this instance consumes.
- **`editor.claimsChord(event)`** answers the same question for one `KeyboardEvent`, using the editor's own normalization. A host key handler can call it directly and skip re-deriving the platform rule: Ctrl and Cmd both fold to `Mod`, so a macOS `Ctrl+B` and a `Cmd+B` give the same answer, and a CapsLock-uppercased letter matches its lowercase binding.

The set is composed on each call, not baked at build time, so it already reflects the block kinds your plugins registered, the global chords they claimed, and the per-instance `keybindings` overrides you passed — a chord you disabled globally drops out, one you bound appears. Turning `searchBar` off drops `Mod+F` and `Mod+H` with it.

**Modifier chords only, by design.** Bare keys — `Enter`, `Tab`, `Escape`, the arrows, `Backspace` — never appear, and that is the contract rather than an omission. A focused document owns them whatever the set says, so an app shortcut bound to one is lost while the caret is in a block regardless. The same reasoning is why the set is the right input for an accelerator table and the wrong input for a "what can the user press here" help sheet: for that, use the [shortcut table](#keyboard-shortcuts).

Two things the answer cannot cover. It describes the chords the editor _consumes_, not the ones that _reach it_ — a shell that resolves its accelerator first takes the chord before any handler runs, which is the measurement this section opens with. And a chord the editor does not claim is not thereby free: the browser's own editing chords still apply inside a contenteditable.

### Clipboard in a webview

**Plain text is the whole model.** Every copy and cut writes `text/plain`, every paste reads it, and there is no HTML flavor to negotiate. What crosses the boundary is Markdown source.

- **A clipboard event may target `document.body` rather than the editor.** Where the selection's focus endpoint hosts no caret (an image-only paragraph, a thematic break), Chromium dispatches `copy` / `cut` / `paste` at the body instead of at the focused block. The editor handles its own case with a root-level handler, so cross-block copy works. What it means for you is that an editor clipboard event does not reliably originate inside the editor's DOM: a host listener that claims clipboard events by "the target is outside the editor" will claim the editor's.
- **Multi-line writes normalize to the OS line ending.** The whole-block copy chord (`Mod+C` / `Mod+X` on a block focused as a whole) writes through `navigator.clipboard.writeText`, and Chromium rewrites a multi-line payload to the platform's line ending, CRLF on Windows. Pasting back into the editor re-normalizes to LF, so documents are unaffected; a host that reads the system clipboard itself normalizes on its own side.
- **That asynchronous write is the path to prove in your shell.** wry has refused `writeText` in some contexts, which is why every other clipboard route writes synchronously through the event object instead. A refused write is contained rather than thrown: nothing reaches the clipboard, a dev build warns, and a cut degrades to leaving the block alone.

### Images and host protocols

Scheme checking happens at the render sink, on whatever `resolveImageUrl` / `resolveLinkUrl` returned. A URL outside the admitted set renders inert and lossless: the image never loads and its widget is marked blocked, a link becomes an unlinked span, and the Markdown bytes are untouched in both cases. That blocked state is not `imageLoadPolicy: 'placeholder'`, which defers loading an image the policy allows.

| Sink      | Admitted schemes                 |
| --------- | -------------------------------- |
| `img` src | `http`, `https`, `data`, `asset` |
| link href | `http`, `https`, `mailto`, `tel` |

A URL carrying no scheme at all (relative, fragment) is admitted at both sinks. The two sets differ deliberately: `asset:` hands bytes to an `<img>` and nothing has asked to navigate to one, so the same URL that renders as an image is rejected as an href.

- **`asset:` is admitted for the desktop case.** Tauri's `convertFileSrc` yields `http://asset.localhost/…` on Windows and `asset://localhost/…` on macOS and Linux, so a shell whose local images all render on a Windows machine can have every one of them blocked on the other two platforms. Both forms pass; test on each platform regardless.
- **A custom host protocol is not admitted.** A scheme your shell registers for itself is one the allowlist does not know, and images carrying it render blocked. Map it to an admitted scheme inside `resolveImageUrl` (the check runs on what your resolver returns), or serve those bytes over the shell's own `http(s)` origin.
- **The allowlist is not consumer-extensible, and that is the current contract.** Widening it for arbitrary host protocols is a contract surface deferred to the API freeze rather than answered by an ad-hoc prop; `resolveImageUrl` is the seam until then, and it covers the case above.

### Verify in the shell

Run these by hand in the built application, once per platform you ship:

1. Every chord the editor and your app rely on, including whatever the shell reserves for zoom, devtools, and reload.
2. Select-all across blocks containing an image or a thematic break, copy, then paste into an external application.
3. The two routes that reach the async `navigator.clipboard` API instead of a clipboard event: whole-block `Mod+C` / `Mod+X` on a thematic break or a plugin diagram, and the table right-click menu's Paste (see "Menu clipboard caveats" under [Keyboard shortcuts](#keyboard-shortcuts)).
4. Multi-line text copied from a native application and pasted into a block.
5. An image pasted from the system clipboard, if `onPasteImage` is installed (see [Image paste](#image-paste)).
6. A local-file image, on each platform, since the asset protocol takes a different form on Windows.
7. Selection restore across a document or tab swap, if you persist a caret (see [Restoring a selection](#restoring-a-selection)).

A glitch that only reproduces inside the shell is what the interaction trace exists for: arm it, reproduce, and serialize a report that travels back out (see [Diagnostics](#diagnostics)).

## Multiple instances

Mounting two or more editors in one JavaScript context is supported. The boundary:

- **Schema is process-global.** The block grammar — block kinds, their components, openers, and commands — is one shared definition set per context. This is the `customElements` model: a kind is a definition every instance sees, and registering the same kind twice is a conflict, not a per-instance override.
- **Runtime state is per-instance.** Selection, undo history, transient render caches — everything mutable an editor accumulates is scoped to that editor. Nothing one instance does to its own state reaches another.

Two editors share one grammar and never share state.

## Plugins

Plugins extend the grammar with new block and inline kinds. Writing one is the [plugin author guide](plugin-guide.md)'s subject; installing one is a prop:

```svelte
<Editor {source} {plugins} />
```

Units install once at mount, in array order, before the first parse. Build the array at module scope rather than inline in the markup — an inline array re-mints the units on every render (a harmless dev-warn, but noise you don't need).

Because definitions are process-global (the [multiple-instances](#multiple-instances) boundary), passing the same plugin to two editors registers it once. Per-instance configuration still works: an entry may be `{ plugin, options }` instead of a bare unit, and the two editors receive their own `options` even though the registration is shared — the split-pane case. Reach for this over the plugin's own factory argument for anything two editors would vary; a factory argument only takes effect on the first install.

For a `parse()` pipeline with no `<Editor>` mounted, call `installPlugins(units)` from the barrel to make the grammar live.

A later editor may mount carrying a plugin an earlier one never had. The late install is legal and serves the new editor's own parse; an already-parsed editor does not re-parse against the newer grammar, and a dev-warn names the late registration.

### Bundled plugins

Eight first-party plugins ship in the package as subpath exports — install them like any other unit:

```ts
import { admonitionsPlugin } from 'aragonite/plugins/admonitions';
import { detailsPlugin } from 'aragonite/plugins/details';
import { tocPlugin } from 'aragonite/plugins/toc';
import { footnotesPlugin } from 'aragonite/plugins/footnotes';
import { emojiPlugin } from 'aragonite/plugins/emoji';
import { highlightOccurrencesPlugin } from 'aragonite/plugins/highlight-occurrences';
import { latexPlugin } from 'aragonite/plugins/latex';
import { mermaidPlugin } from 'aragonite/plugins/mermaid';
```

`admonitionsPlugin()` renders `:::name` directive callouts and native GitHub alerts (`> [!NOTE]` blockquotes) as styled boxes, GitHub bytes untouched. Pass `{ convertAlertsOnPaste: true }` to rewrite pasted alerts to directive source instead of rendering them natively.

`tocPlugin()` turns a `[[toc]]` line into a live table of contents: every heading in the document, indented by level, each entry navigating to its heading on click or on Enter from the keyboard. The walk descends into containers, so headings inside blockquotes, lists, and callouts are listed too. Pass `{ maxDepth }` (1 through 6, default 6) to list only the top levels. Navigation is view-only, so entries work in every presentation mode.

`footnotesPlugin()` teaches the editor GFM footnotes: `[^label]: content` definitions render as an editable block, and `[^label]` references render as superscript numbers derived from first-reference order. One clipboard consequence to know: copying part of a single-paragraph definition's body carries its `[^label]: ` marker along (the marker is that block's own source, and a slice without it reparses as a bare paragraph), so pasting that slice elsewhere lands a second definition under the same label.

`emojiPlugin()` teaches the editor GitHub `:shortcode:` emoji: a bare `:name:` renders as a glyph widget while the literal `:name:` bytes stay in the source, so round-trip and portability are untouched. Recognition is gated on installation — without the plugin, `:name:` is ordinary prose.

`highlightOccurrencesPlugin()` highlights every other occurrence of the word under the caret across the document's prose blocks — a view-only decoration, never a byte change.

`latexPlugin({ renderer })` renders all three GitHub math forms through one injected engine: inline `$…$`, block `$$…$$`, and the fenced ` ```math ` form. Uninstalled, each stays its lossless plain reading (prose, or a plain `math` code block).

latex and mermaid render through **injected engines** that never ride the main bundle: each has a `/renderer` subpath adapter, and its engine (`katex` / `mermaid`) is an optional peer dependency you install only if you use it.

```ts
import { katexRenderer } from 'aragonite/plugins/latex/renderer'; // imports katex + its CSS
import { mermaidRenderer } from 'aragonite/plugins/mermaid/renderer'; // dynamic-imports mermaid

latexPlugin({ renderer: katexRenderer });
mermaidPlugin({ renderer: mermaidRenderer });
```

The two differ on whether the renderer is required, and the asymmetry is deliberate. Math without a renderer has no honest fallback — a formula would render as nothing — so `latexPlugin` requires one at the type level. A mermaid block without an engine still has a useful static form (the fenced source, styled), so `mermaidPlugin()` is legal and renders statically; supply the renderer when you want live diagrams.

The latex adapter imports `katex/dist/katex.min.css` on your behalf (it is the one bundled-plugin module with a side effect); no other setup is needed.

## Theming

The module owns its CSS. Two stylesheets ship under `styles/`:

- **`editor.css`** — structural painting rules. Auto-imported by the component; nothing to do.
- **`editor-theme.css`** — the default token palette, light and dark. Import it for the default look, or replace it wholesale to retheme. **It is the authoritative manifest** — read it for the exact token set and values rather than trusting a copy in a doc.

A plugin's render engine may carry its own stylesheet (KaTeX's `katex.min.css`, say). That CSS is the plugin's to load, not the editor module's.

### Scope

Tokens are declared on the editor's own root (`.editor`), never on `:root` — the module does not inject custom properties into your global scope. To give the same palette to non-editor chrome (a surrounding toolbar, a placeholder editor), add the `aragonite-editor-theme` class to a wrapper; it inherits the identical token set with no token declarations of your own.

### Light / dark

Mode keys on `data-editor-theme` on the scoped element. Set the `theme` prop on `<Editor>` (`'dark'` default, `'light'`, or any custom name); on an `.aragonite-editor-theme` wrapper, set the attribute directly. **Dark is the base** — `'light'` overrides only the tokens that differ.

The prop is **live**: changing it rethemes the surface through the cascade, and plugin content whose colors an engine PAINTS rather than CSS styles (a Mermaid diagram's SVG) is redrawn for the new theme — nothing is a mount-time snapshot. A theme change writes no document bytes.

### Overriding and custom themes

Three paths, by scope:

1. **Override individual tokens** — declare them on `.editor` (or a narrower selector of your own) in a stylesheet loaded after `editor-theme.css`. Custom properties cascade, so `.editor { --syntax-heading: #f90; }` wins. Per-mode: `.editor[data-editor-theme='light'] { … }`.
2. **Add a named theme** — define `.editor[data-editor-theme='solarized'] { … }` and pass `theme="solarized"`. The base block supplies fallbacks for any token the custom theme omits, so a partial theme overrides only what it names.
3. **Replace wholesale** — skip `editor-theme.css` and ship your own token file scoped to `.editor`.

### Theme tokens

Every token is editor-owned and declared in `editor-theme.css`. The role table below is the stable **host-chrome contract** — the tokens the editor and its plugins read to blend into your app. Override any of them at `.editor` or a wrapper, never `:root`.

| Role            | Token(s)                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| **Font**        | `--font-editor`, `--editor-font-size` _(mode-independent — one value each)_       |
| **Text**        | `--color-text`, `--color-text-primary`                                            |
| **Muted**       | `--color-text-muted`, `--color-ui-muted`, `--color-ui-dulled`, `--color-ui-faint` |
| **Accent**      | `--color-accent`                                                                  |
| **Borders**     | `--color-border`                                                                  |
| **Backgrounds** | `--color-bg`, `--color-bg-secondary`, `--color-bg-elevated`, `--color-bg-muted`   |
| **Danger**      | `--color-danger`                                                                  |

**Both-themes guarantee.** Each `--color-*` token carries a light _and_ a dark value — the base block is dark, `data-editor-theme='light'` overrides it — so a read resolves correctly in either mode. The two font tokens are the exceptions: mode-independent, declared once.

**`--editor-font-size` is the type-scale root.** Headings, code, markers and chrome are all `em`-relative, so overriding this one token scales the whole surface. Set it at `.editor` — **not on a wrapper**. The token is declared on the editor's own root, so a value inherited from an ancestor is shadowed by that declaration and does nothing. To drive it from a host value that changes (a zoom control, a user text-size setting), bridge it through a property of your own: `.editor { --editor-font-size: var(--my-zoom, 1rem); }`. A live change is supported: virtual rendering re-estimates the document at the new scale, so a zoom control is a first-class use of the token, not a mount-time-only one.

Outside that contract sits the editor's own visual language — the syntax and code-token palettes, the Markdown-marker colors, the selection and search overlays, and the reorder/windowing surfaces. Those are dark-based or mode-independent. Read `editor-theme.css` if you mean to retheme them.

**Plugin fallbacks.** A plugin reading a token keeps an inline fallback (`var(--color-text-muted, #aaaaaa)`) so it renders host-less. The fallback fires only outside `.editor` scope, where no token is declared — so match it to the token's **dark base** value in `editor-theme.css`, never the light one.

## Keyboard shortcuts

`Mod` is Ctrl on Windows/Linux and Cmd on macOS.

Chord strings compose the modifiers in fixed order (`Mod`, `Alt`, `Shift`) with the key's own value, single letters uppercased. Shifted-symbol forms are not modeled: `Shift+1` reaches the editor as whatever symbol the keyboard layout produces, so bind digits and letters (`Mod+7`), never the shifted symbol.

This table is for a reader. An app deriving an accelerator map should read `editor.reservedChords()` instead — it is composed from the live keymaps and covers the chords claimed outside them (see [Which shortcuts the editor consumes](#which-shortcuts-the-editor-consumes)).

**What the `keybindings` prop can rebind.** The prop rebinds — or disables, with a `null` command — chords that route through the keymap: the **Editing**, **Block reorder** and **Tables** families below, and any chord a plugin kind contributes. An override's `kind` scope also takes a plugin kind; name it through the plugin's exported kind constant (the branded string — a raw literal won't typecheck).

Scoping by kind is what makes the shared structural chords reachable, because a chord like `Tab` is bound separately on every kind that wants it. `{ kind: 'listItem', chord: 'Tab', command: null }` frees `Tab` inside list items (for focus traversal in a form-embedded editor, say) and leaves `Tab` alone in code blocks and prose.

**Scope table chords to `tableCell`, not `table`.** Inside a table the cell holds the caret, so the cell's kind is what resolves a chord: `{ kind: 'tableCell', chord: 'Mod+Enter', command: null }` frees the insert-row chord, while the same entry scoped to `table` resolves against a block that never receives a keystroke and silently does nothing.

Two cell gestures sit outside the keymap entirely, because both depend on where the caret sits inside the cell rather than on the chord: **arrow navigation** between cells, and the three-stage `Mod+A` (cell text, then the table, then the document). They are not commands, so the two override directions are asymmetric — worth knowing before you scope one:

- A **disable** cannot reach them. `{ kind: 'tableCell', chord: 'Mod+A', command: null }` unbinds nothing (there was no binding) and the three-stage gesture keeps running.
- A **bind** shadows them completely. `{ kind: 'tableCell', chord: 'ArrowUp', command: 'table.deleteRow' }` resolves first and the cell never navigates. That is the intended precedence — an explicit binding wins — but it means claiming an arrow or `Mod+A` for your own command takes the built-in gesture with it.

Disabling `Tab` or `Enter` for `tableCell` likewise leaves the cell with no way to reach the next cell or append a row, so scope those deliberately.

The **Find / replace** family does **not** consult the override map at all — those chords are wired directly into the search components, and are not rebindable today.

**Plugin-global chords resolve last.** A plugin's global command (see the plugin guide) may claim a chord in the plugin-global tier, which resolves after every `keybindings` override, built-in kind chord, and built-in global chord — so a plugin chord never shadows a built-in binding, and the Find/replace chords `Mod+F` / `Mod+H` are reserved outright. The shadow runs the other way by design: a built-in kind's own chord beats a plugin-global chord **on that kind, not elsewhere** — a plugin's `Mod+B` fires on a thematic break (which binds no `Mod+B`) but yields to bold-toggle inside a paragraph.

Tables also carry pointer affordances: hovering a row or column reveals a grip you can drag to reorder it or click for a row/column action menu, and right-clicking any cell opens that same menu (with cut/copy/paste). Shift+F10 or the Context Menu key opens it from the keyboard.

| Action                              | Chord                                               |
| ----------------------------------- | --------------------------------------------------- |
| **Editing**                         |                                                     |
| Bold (toggle strong)                | `Mod+B`                                             |
| Italic (toggle emphasis)            | `Mod+I`                                             |
| Cycle heading level                 | `Mod+0`–`Mod+6` (0 clears, 1–6 set `#`–`######`)    |
| Split a block                       | `Enter` (in a code block, inserts a newline)        |
| Hard line break                     | `Shift+Enter`                                       |
| Merge into the block before / after | `Backspace` / `Delete` (at the block's start / end) |
| Indent / outdent a list item        | `Tab` / `Shift+Tab`                                 |
| Indent / dedent a code line         | `Tab` / `Shift+Tab`                                 |
| Insert a tab in prose               | `Tab`                                               |
| Undo                                | `Mod+Z`                                             |
| Redo                                | `Mod+Y` or `Mod+Shift+Z`                            |
| **Block reorder**                   |                                                     |
| Move block up / down                | `Alt+↑` / `Alt+↓`                                   |
| **Find / replace**                  |                                                     |
| Open find                           | `Mod+F`                                             |
| Open find + replace                 | `Mod+H`                                             |
| Next / previous match               | `Enter` / `Shift+Enter` (in the find field)         |
| Close search                        | `Esc`                                               |
| **Tables**                          |                                                     |
| Move between cells                  | `Tab` / `Shift+Tab`, arrow keys                     |
| Next row (or add one)               | `Enter` (from the last cell, appends a row)         |
| Insert row below / above            | `Mod+Enter` / `Mod+Shift+Enter`                     |
| Insert column right / left          | `Alt+Shift+→` / `Alt+Shift+←`                       |
| Delete row                          | `Mod+Shift+Backspace`                               |
| Delete column                       | `Alt+Shift+Backspace`                               |
| Move row up / down                  | `Alt+↑` / `Alt+↓`                                   |
| Move column left / right            | `Alt+←` / `Alt+→`                                   |
| Move the whole table up / down      | `Mod+Alt+↑` / `Mod+Alt+↓`                           |
| Cycle column alignment              | `Mod+Shift+A`                                       |
| **Clipboard**                       |                                                     |
| Copy / cut a focused block          | `Mod+C` / `Mod+X`                                   |
| Copy / cut a selected image         | `Mod+C` / `Mod+X`                                   |

**The Editing rows assume a caret in ordinary block content.** Inside a table cell, `Enter`, `Tab` and `Shift+Tab` mean what the **Tables** rows say instead — the `tableCell` keymap binds them to the cell's own commands, which shadow the prose bindings for as long as the caret is in a cell. `Alt+↑` / `Alt+↓` likewise move the caret's ROW rather than the block; the whole table moves among its siblings on `Mod+Alt+↑` / `Mod+Alt+↓`.

**Whole-block clipboard.** A block focused as a whole — a thematic break or a plugin diagram — has no text selection, so `Mod+C` / `Mod+X` copy or cut the block's own Markdown (cut removes the block); the same chords on a selected inline image act on the image's source. In reading mode copy works and cut degrades to copy.

**Menu clipboard caveats.** The right-click menu's Cut/Copy write the cell's _rendered_ text, which differs from keyboard `Mod+X`'s raw-source slice for a cell holding an inline widget (a literal `<br>`, say). Menu Paste reads through `navigator.clipboard.readText()` — the one clipboard path not yet proven on the Tauri/wry webview. Keyboard `Mod+V` is unaffected.

## Events

Subscribe to the observer surface via `editor.getEvents()`. Five channels:

| Channel                  | Fires                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `edit`                   | After every commit (structural ops, the debounced typing flush, undo/redo)                                                       |
| `selectionChange`        | Whenever the selection changes; payload is the snapshot or `null`                                                                |
| `error`                  | On a failure the editor contains rather than propagates (subscriber / render / commit / command / decoration / clipboard origin) |
| `presentationModeChange` | After a `presentationMode` prop change; payload is the effective mode (never fired at mount)                                     |
| `themeChange`            | After a `theme` prop change; payload is the theme name (never fired at mount)                                                    |

The payload envelopes — read the source types for the per-op arms, which change as operations are added:

- **`EditEvent`** (`edit`) — `{ op, path, detail?, timestamp }`, discriminated by `op`. `path` is doc-absolute for every op — nested ops and the typing flush included — and resolves from the document root to the operated node.
- **`SelectionChangeEvent`** (`selectionChange`) — the `EditorSelection` snapshot, or `null` when nothing is focused.
- **`EditorError`** (`error`) — `{ origin, error, context? }`, where `origin` is `subscriber | render | commit | command | decoration | clipboard` and `context` carries the block path or op kind when known (the block kind, command id, and owning plugin for a `command` throw; the source name for a `decoration` throw; the range the paste was aimed at, where there was one, for a `clipboard` failure).
- **`PresentationMode`** (`presentationModeChange`) — the effective mode after a `presentationMode` prop change; a bare mode value, not a `{…}` envelope, and never fired at mount.
- **`string`** (`themeChange`) — the theme name after a `theme` prop change; a bare value, never fired at mount. Only plugin content that PAINTS its own colors needs it; token-styled content rethemes itself through the cascade.

`on(name, cb)` returns a disposer; call it to unsubscribe. Events fire synchronously from their emission sites. **Handlers must not mutate the document** — reentrant edits are not supported.

## Diagnostics

`getDiagnostics()` returns the field-report door. The editor's hardest bugs live in the inline layer, where every state is transient — spans rebuild on each keystroke, so cursor moves, reveal open/fold, widget-pool churn, and IME composition are gone by the time a report is read. The **interaction trace** is a ring buffer that records those transitions as they happen. It ships **default-off**, behind one cheap check per recorder, so arming it is your call. The trace is process-global: two editors on one page interleave their entries in the one buffer.

The workflow when a user hits an inline glitch: **reproduce → serialize → attach.**

1. `enableTrace()` — arm the recorder (once, e.g. behind a "report a bug" affordance).
2. Reproduce the glitch.
3. `serializeDiagnostics()` — returns a fenced-markdown snapshot (timestamp, the trace tail, the recent operations, the selection) to drop straight into a bug ticket.

`traceSnapshot()` returns the raw `InteractionTraceEntry[]` if you'd rather format it yourself; `disableTrace()` / `isTraceEnabled()` round out the switch.

**The document is excluded by default.** `serializeDiagnostics()` never includes the document source unless you pass `{ includeSource: true }` — a field report must not leak a user's content. Opt in only when the bytes are part of the repro and the user has consented.

The door grows by adding methods to the same object, never a second door — future diagnostics arrive as more fields on `EditorDiagnostics`.

## Search

`getSearch()` returns the imperative find/replace controller (`SearchState`) — the same engine the built-in bar drives. Use it to set the query and options (case sensitivity, whole-word, regex), step through matches, and replace one or all. The `searchBar` prop renders the built-in UI over that controller; set it `false` to drive search from your own chrome.

## Decorations and rects

Two read/annotate surfaces for building chrome _around_ the document — toolbars, popups, highlights — without touching its bytes.

**`getDecorations()`** registers a view-only annotation source directly, no plugin needed: highlights, badges, folds that live and die with your app's state. It is the same registry a plugin reaches through its editor context, with the same contract — a named source whose `provide(document)` is pure over a read-only `DocumentView`, re-run after every edit, `invalidate()` for your own state changes, `dispose()` to remove. Authoring semantics, the four decoration types, and the memoization recipe are in the [plugin guide](plugin-guide.md#decorations); everything there applies verbatim to a consumer-registered source.

**`getRects()`** answers "where is that, on screen?" in viewport coordinates:

| Method                         | Returns                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blockRect(path)`              | The block's bounding box, or `null` when it isn't mounted                                                                                        |
| `rangeRects(path, start, end)` | The rects covering an inline range — one per visual line on wrapped text, one per cell on a table                                                |
| `caretRect()`                  | The live native caret, or `null` (including whenever a cross-block selection is active)                                                          |
| `reveal(path)`                 | Mounts a block the virtual window has unmounted, resolving `true` once its element exists                                                        |
| `scrollTo(path, opts?)`        | Mounts the block, then scrolls the viewport to it (`opts.block`: `'nearest'` default, or `'center'`; `opts.hold`: keep holding it, default true) |
| `navigateTo(path)`             | The same, plus lands the caret at the block's start — what a navigation affordance owes the user                                                 |

Offsets are raw offsets into the block (dimmed markers included) on text surfaces, and cell indices on tables. `rangeRects` accepts the exported `SELECTION_END` sentinel as `end`, meaning "through the block's last measurable position".

### Recipe: navigating to a block

`getRects().navigateTo(path)` is the programmatic navigation door — jump to a heading, an outline entry, a cross-reference target. `scrollTo(path, opts)` is the same reveal-and-scroll without the caret landing, for moving the viewport without moving the selection (the built-in search reveal is exactly that call). Four things to know:

- **It mounts first.** A block the virtual window has unmounted has no element to scroll to, so the reveal mounts it and then scrolls. `reveal(path)` is that same mount without the scroll, for measuring something offscreen.
- **The boolean is honest.** It resolves only after the position settles, so `true` means the block is genuinely in view — not merely that the call ran. A target that cannot mount (one inside a collapsed `<details>` or admonition, say) resolves `false` and leaves nothing pinned.
- **`'nearest'` holds, `'center'` places.** The default `'nearest'` keeps the target visible through the reflow a mount triggers (images decoding above it collapse the document height). `'center'` places the block precisely once the scroll settles, and stops holding it after. Pass `hold: false` to hand the viewport straight back — what a restore that writes its own remembered scroll position afterwards wants.
- **Land the caret if a user asked to go there.** A navigation affordance that only scrolls leaves focus on whatever the user clicked, where the editor's chords do not reach: an undo typed right after the jump does nothing. `navigateTo` places the caret at the target through the same restore road `setSelection` and undo use, which is why it is a distinct call rather than a flag.

Paths are child indices into the document tree, so resolve one by walking `parse(getSource())` — filter for `heading` and `setextHeading`, recursing into container children so headings inside blockquotes and lists are reachable too. The bundled toc plugin does exactly that walk over its live document, and clicking one of its entries is a `navigateTo` call.

### Recipe: a selection toolbar

Float a formatting bar above the user's selection — the standard use of the two surfaces together:

1. **Subscribe to `selectionChange`.** A `null` payload or a collapsed selection (anchor equals focus) hides the bar.
2. **Cross-block selections** (anchor and focus in different blocks): normalize the endpoints yourself (compare paths, then offsets), then anchor to `rangeRects(startPath, startOffset, SELECTION_END)` — the start block's rects from the selection to its end. Rect `[0]` is the first visual line; place the bar above its top-left.
3. **Single-block selections** (anchor and focus in the same block): `getSelection()` reports the range's real endpoints — distinct anchor/focus raw offsets on the shared path — so anchor with `rangeRects(path, startOffset, endOffset)`, the same call as the cross-block case with a real end offset in place of `SELECTION_END`. (Reading the native `window.getSelection()` range works too, since within one block the editor delegates selection to the browser.)
4. **Re-anchor on the next `selectionChange`, not on scroll.** Rects are viewport-space snapshots; a `position: fixed` bar drifts under scroll until the selection next changes. Wire a scroll listener only if your UX demands live tracking.

The demo route's `SelectionToolbar` component follows this recipe; its single-block branch still reads the native Range directly — an equivalent that predates within-block range reporting.

## Rewriting a document

Consumers never assemble a mutation ceremony. Edits happen through the component, and every commit surfaces on the `edit` channel. How an edit is applied internally is not part of the consumer contract.

Paste sits on that boundary: pasted text is parsed as authored. A _plugin_ may rewrite that text before it is parsed, through a content-keyed, paste-scoped hook (`registerPasteTransform` — see the plugin guide). Never the load path, never typing.

The consumer-side lever for rewriting a whole document — converting legacy syntax, migrating content, applying a bulk fix — is at the document level: read `getSource()`, transform the Markdown, and write the result back through the `source` prop. The replacement is one document swap, so undo history and the caret do not survive it. That is the honest shape for an import-or-convert affordance, and pretending otherwise would only hide the seam.

A transformer working over `parse`'s output can lean on the composition contract: the serialized document is exactly `prefix + Σ(child.leadingTrivia + child.raw) + suffix` over the document's children. A rewrite can therefore replace individual blocks' bytes and reassemble without touching the rest.
