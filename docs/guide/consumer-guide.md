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
2. **`bind:this` is the read surface** — `getSource()`, `getSelection()`, `getEvents()`, `getSearch()`, `getRects()`, `getDecorations()`.
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

| Group                  | What you get                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Component**          | `Editor`, plus `EditorProps` and `EditorInstance` — the prop shape and the `bind:this` surface                                                                                      |
| **Policy types**       | `ResolveImageUrl`, `ResolveLinkUrl`, `ImageLoadPolicy` — the types the behavior props reference                                                                                     |
| **Plugins**            | `installPlugins` for an editor-less pipeline; `EditorPlugin` (the unit) and `EditorPluginEntry` (a `plugins` entry — a bare unit or `{ plugin, options }` for per-instance options) |
| **Selection + keymap** | `EditorSelection` (what `getSelection()` returns), `KeybindingOverride` and `CommandId` (what the `keybindings` prop takes)                                                         |
| **Search**             | `SearchState`, `SearchOptions`, `Match` — the find/replace controller, its options, and one hit                                                                                     |
| **Decorations**        | `DecorationRegistry` and the decoration types — what `getDecorations()` returns (see [Decorations and rects](#decorations-and-rects))                                               |
| **Rects**              | `EditorRects` — what `getRects()` returns: viewport-space geometry over the rendered document                                                                                       |
| **CST utilities**      | `parse` / `serialize` for round-tripping Markdown outside the component; `parseInline`, `getContentRange`, `isProseKind` for inspecting a block's inline content and editable range |
| **Node types**         | `CstNode`, `Document`, the block-kind and inline-node unions, and the per-kind metadata shapes — the vocabulary for reading a parsed document                                       |
| **Events**             | `EditorEvents` and the three payload types the observer surface emits                                                                                                               |

### The component contract

`<Editor>` is controlled-by-prop-at-mount, read imperatively.

- **`source`** is read once at mount. An internal effect re-syncs the document if the prop changes; there is no two-way binding.
- **`bind:this`** exposes six methods:
  - **`getSource()`** — serialize the live document back to Markdown.
  - **`getSelection()`** — a frozen snapshot of the current selection, or `null` when nothing is focused. Path arrays are copies.
  - **`getEvents()`** — the observer surface (see [Events](#events)).
  - **`getSearch()`** — the find/replace controller (see [Search](#search)).
  - **`getRects()`** — viewport-space geometry over the rendered document (see [Decorations and rects](#decorations-and-rects)).
  - **`getDecorations()`** — register a view-only annotation source, no plugin needed (same section).

## Behavior / policy props

Optional props customize URL and image handling and the editor's affordances.

| Prop               | Effect                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveImageUrl`  | Rewrite a raw image URL before it reaches `img.src` (resolve a relative path, say)                                                        |
| `resolveLinkUrl`   | Rewrite a raw link href at render time                                                                                                    |
| `imageLoadPolicy`  | `auto` (load images) or `placeholder` (defer loading)                                                                                     |
| `onLinkActivate`   | Handle a link click (Ctrl/Cmd+click or activation); replaces the default `window.open`                                                    |
| `blockDragHandles` | Toggle the mouse-only hover drag handle (default on); keyboard reorder (Alt+Arrow) is always available                                    |
| `searchBar`        | Toggle the in-document find/replace bar and its Ctrl+F / Ctrl+H shortcuts (default on)                                                    |
| `theme`            | Theme name reflected to `data-editor-theme` on the editor root; `'dark'` (default), `'light'`, or a custom name (see [Theming](#theming)) |
| `keybindings`      | Per-instance keymap overrides — rebind or disable a chord (see [Keyboard shortcuts](#keyboard-shortcuts))                                 |
| `plugins`          | Plugin units installed once at mount, in array order, before the first parse (see [Plugins](#plugins))                                    |

**Set-once at mount** — `resolveImageUrl`, `resolveLinkUrl`, `imageLoadPolicy`, `onLinkActivate`, `blockDragHandles`, and `plugins`. They thread to the renderer through context, and a post-mount swap is not guaranteed to re-render already-built blocks; set them at mount and treat them as fixed for the editor's lifetime. `theme`, `searchBar`, and `keybindings` are the exceptions — they read live and may change after mount.

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

## Theming

The module owns its CSS. Two stylesheets ship under `styles/`:

- **`editor.css`** — structural painting rules. Auto-imported by the component; nothing to do.
- **`editor-theme.css`** — the default token palette, light and dark. Import it for the default look, or replace it wholesale to retheme. **It is the authoritative manifest** — read it for the exact token set and values rather than trusting a copy in a doc.

A plugin's render engine may carry its own stylesheet (KaTeX's `katex.min.css`, say). That CSS is the plugin's to load, not the editor module's.

### Scope

Tokens are declared on the editor's own root (`.editor`), never on `:root` — the module does not inject custom properties into your global scope. To give the same palette to non-editor chrome (a surrounding toolbar, a placeholder editor), add the `aragonite-editor-theme` class to a wrapper; it inherits the identical token set with no token declarations of your own.

### Light / dark

Mode keys on `data-editor-theme` on the scoped element. Set the `theme` prop on `<Editor>` (`'dark'` default, `'light'`, or any custom name); on an `.aragonite-editor-theme` wrapper, set the attribute directly. **Dark is the base** — `'light'` overrides only the tokens that differ.

### Overriding and custom themes

Three paths, by scope:

1. **Override individual tokens** — declare them on `.editor` (or a narrower selector of your own) in a stylesheet loaded after `editor-theme.css`. Custom properties cascade, so `.editor { --syntax-heading: #f90; }` wins. Per-mode: `.editor[data-editor-theme='light'] { … }`.
2. **Add a named theme** — define `.editor[data-editor-theme='solarized'] { … }` and pass `theme="solarized"`. The base block supplies fallbacks for any token the custom theme omits, so a partial theme overrides only what it names.
3. **Replace wholesale** — skip `editor-theme.css` and ship your own token file scoped to `.editor`.

### Theme tokens

Every token is editor-owned and declared in `editor-theme.css`. The role table below is the stable **host-chrome contract** — the tokens the editor and its plugins read to blend into your app. Override any of them at `.editor` or a wrapper, never `:root`.

| Role            | Token(s)                                                                          |
| --------------- | --------------------------------------------------------------------------------- |
| **Font**        | `--font-editor` _(mode-independent — one value)_                                  |
| **Text**        | `--color-text`, `--color-text-primary`                                            |
| **Muted**       | `--color-text-muted`, `--color-ui-muted`, `--color-ui-dulled`, `--color-ui-faint` |
| **Accent**      | `--color-accent`                                                                  |
| **Borders**     | `--color-border`                                                                  |
| **Backgrounds** | `--color-bg`, `--color-bg-secondary`, `--color-bg-elevated`, `--color-bg-muted`   |
| **Danger**      | `--color-danger`                                                                  |

**Both-themes guarantee.** Each `--color-*` token carries a light _and_ a dark value — the base block is dark, `data-editor-theme='light'` overrides it — so a read resolves correctly in either mode. `--font-editor` is the one exception: mode-independent, declared once.

Outside that contract sits the editor's own visual language — the syntax and code-token palettes, the Markdown-marker colors, the selection and search overlays, and the reorder/windowing surfaces. Those are dark-based or mode-independent. Read `editor-theme.css` if you mean to retheme them.

**Plugin fallbacks.** A plugin reading a token keeps an inline fallback (`var(--color-text-muted, #aaaaaa)`) so it renders host-less. The fallback fires only outside `.editor` scope, where no token is declared — so match it to the token's **dark base** value in `editor-theme.css`, never the light one.

## Keyboard shortcuts

`Mod` is Ctrl on Windows/Linux and Cmd on macOS.

Chord strings compose the modifiers in fixed order (`Mod`, `Alt`, `Shift`) with the key's own value, single letters uppercased. Shifted-symbol forms are not modeled: `Shift+1` reaches the editor as whatever symbol the keyboard layout produces, so bind digits and letters (`Mod+7`), never the shifted symbol.

**What the `keybindings` prop can rebind.** The prop rebinds — or disables, with a `null` command — chords that route through the keymap: the **Editing** and **Block reorder** families below, and any chord a plugin kind contributes. An override's `kind` scope also takes a plugin kind; name it through the plugin's exported kind constant (the branded string — a raw literal won't typecheck). The **Tables** and **Find / replace** families do **not** consult the override map: table chords are structural predicates in the cell's own keydown plan, and the find chords are wired directly into the search components. Rebinding those is tracked in `docs/issues.md` and is not available today.

**Plugin-global chords resolve last.** A plugin's global command (see the plugin guide) may claim a chord in the plugin-global tier, which resolves after every `keybindings` override, built-in kind chord, and built-in global chord — so a plugin chord never shadows a built-in binding, and the Find/replace chords `Mod+F` / `Mod+H` are reserved outright. The shadow runs the other way by design: a built-in kind's own chord beats a plugin-global chord **on that kind, not elsewhere** — a plugin's `Mod+B` fires on a thematic break (which binds no `Mod+B`) but yields to bold-toggle inside a paragraph.

Tables also carry pointer affordances: hovering a row or column reveals a grip you can drag to reorder it or click for a row/column action menu, and right-clicking any cell opens that same menu (with cut/copy/paste). Shift+F10 or the Context Menu key opens it from the keyboard.

| Action                     | Chord                                            |
| -------------------------- | ------------------------------------------------ |
| **Editing**                |                                                  |
| Bold (toggle strong)       | `Mod+B`                                          |
| Italic (toggle emphasis)   | `Mod+I`                                          |
| Cycle heading level        | `Mod+0`–`Mod+6` (0 clears, 1–6 set `#`–`######`) |
| Undo                       | `Mod+Z`                                          |
| Redo                       | `Mod+Y` or `Mod+Shift+Z`                         |
| **Block reorder**          |                                                  |
| Move block up / down       | `Alt+↑` / `Alt+↓`                                |
| **Find / replace**         |                                                  |
| Open find                  | `Mod+F`                                          |
| Open find + replace        | `Mod+H`                                          |
| Next / previous match      | `Enter` / `Shift+Enter` (in the find field)      |
| Close search               | `Esc`                                            |
| **Tables**                 |                                                  |
| Move between cells         | `Tab` / `Shift+Tab`, arrow keys                  |
| Next row (or add one)      | `Enter` (from the last cell, appends a row)      |
| Insert row below / above   | `Mod+Enter` / `Mod+Shift+Enter`                  |
| Insert column right / left | `Alt+Shift+→` / `Alt+Shift+←`                    |
| Delete row                 | `Mod+Shift+Backspace`                            |
| Delete column              | `Alt+Shift+Backspace`                            |
| Move row up / down         | `Alt+↑` / `Alt+↓`                                |
| Move column left / right   | `Alt+←` / `Alt+→`                                |
| Cycle column alignment     | `Mod+Shift+A`                                    |

**Menu clipboard caveats.** The right-click menu's Cut/Copy write the cell's _rendered_ text, which differs from keyboard `Mod+X`'s raw-source slice for a cell holding an inline widget (a literal `<br>`, say). Menu Paste reads through `navigator.clipboard.readText()` — the one clipboard path not yet proven on the Tauri/wry webview. Keyboard `Mod+V` is unaffected.

## Events

Subscribe to the observer surface via `editor.getEvents()`. Three channels:

| Channel           | Fires                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `edit`            | After every commit (structural ops, the debounced typing flush, undo/redo)                              |
| `selectionChange` | Whenever the selection changes; payload is the snapshot or `null`                                       |
| `error`           | On a failure the editor contains rather than propagates (subscriber / render / commit / command origin) |

The payload envelopes — read the source types for the per-op arms, which change as operations are added:

- **`EditEvent`** (`edit`) — `{ op, path, detail?, timestamp }`, discriminated by `op`. `path` is doc-absolute for every op — nested ops and the typing flush included — and resolves from the document root to the operated node.
- **`SelectionChangeEvent`** (`selectionChange`) — the `EditorSelection` snapshot, or `null` when nothing is focused.
- **`EditorError`** (`error`) — `{ origin, error, context? }`, where `origin` is `subscriber | render | commit | command` and `context` carries the block path or op kind when known (and, for a `command` throw, the block kind, command id, and owning plugin).

`on(name, cb)` returns a disposer; call it to unsubscribe. Events fire synchronously from their emission sites. **Handlers must not mutate the document** — reentrant edits are not supported.

## Search

`getSearch()` returns the imperative find/replace controller (`SearchState`) — the same engine the built-in bar drives. Use it to set the query and options (case sensitivity, whole-word, regex), step through matches, and replace one or all. The `searchBar` prop renders the built-in UI over that controller; set it `false` to drive search from your own chrome.

## Decorations and rects

Two read/annotate surfaces for building chrome _around_ the document — toolbars, popups, highlights — without touching its bytes.

**`getDecorations()`** registers a view-only annotation source directly, no plugin needed: highlights, badges, folds that live and die with your app's state. It is the same registry a plugin reaches through its editor context, with the same contract — a named source whose `provide(document)` is pure, re-run after every edit, `invalidate()` for your own state changes, `dispose()` to remove. Authoring semantics, the four decoration types, and the memoization recipe are in the [plugin guide](plugin-guide.md#decorations); everything there applies verbatim to a consumer-registered source.

**`getRects()`** answers "where is that, on screen?" in viewport coordinates:

| Method                         | Returns                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `blockRect(path)`              | The block's bounding box, or `null` when it isn't mounted                                         |
| `rangeRects(path, start, end)` | The rects covering an inline range — one per visual line on wrapped text, one per cell on a table |
| `caretRect()`                  | The live native caret, or `null` (including whenever a cross-block selection is active)           |
| `reveal(path)`                 | Mounts a block the virtual window has unmounted, resolving `true` once its element exists         |

Offsets are raw offsets into the block (dimmed markers included) on text surfaces, and cell indices on tables. `rangeRects` accepts the end-of-block sentinel value `Number.MAX_SAFE_INTEGER` as `end`, meaning "through the block's last measurable position".

### Recipe: a selection toolbar

Float a formatting bar above the user's selection — the standard use of the two surfaces together:

1. **Subscribe to `selectionChange`.** A `null` payload or a collapsed selection (anchor equals focus) hides the bar.
2. **Cross-block selections** (anchor and focus in different blocks): normalize the endpoints yourself (compare paths, then offsets), then anchor to `rangeRects(startPath, startOffset, MAX_SAFE_INTEGER)` — the start block's rects from the selection to its end. Rect `[0]` is the first visual line; place the bar above its top-left.
3. **Single-block selections** — the honest caveat: the selection snapshot currently collapses a single-block range to the focus caret (anchor === focus), so the editor's own payload cannot give you the range's geometry. Read the native selection instead: `window.getSelection()!.getRangeAt(0).getBoundingClientRect()` is correct whenever the selection lives inside one block, because there the editor delegates selection to the browser. An additive payload extension is planned; until it lands, the native read is the supported pattern.
4. **Re-anchor on the next `selectionChange`, not on scroll.** Rects are viewport-space snapshots; a `position: fixed` bar drifts under scroll until the selection next changes. Wire a scroll listener only if your UX demands live tracking.

The demo route's `SelectionToolbar` component is this recipe verbatim, including the native-Range fallback.

## Rewriting a document

Consumers never assemble a mutation ceremony. Edits happen through the component, and every commit surfaces on the `edit` channel. How an edit is applied internally is not part of the consumer contract.

Paste sits on that boundary: pasted text is parsed as authored. A _plugin_ may rewrite that text before it is parsed, through a content-keyed, paste-scoped hook (`registerPasteTransform` — see the plugin guide). Never the load path, never typing.

The consumer-side lever for rewriting a whole document — converting legacy syntax, migrating content, applying a bulk fix — is at the document level: read `getSource()`, transform the Markdown, and write the result back through the `source` prop. The replacement is one document swap, so undo history and the caret do not survive it. That is the honest shape for an import-or-convert affordance, and pretending otherwise would only hide the seam.

A transformer working over `parse`'s output can lean on the composition contract: the serialized document is exactly `prefix + Σ(child.leadingTrivia + child.raw) + suffix` over the document's children. A rewrite can therefore replace individual blocks' bytes and reassemble without touching the rest.
