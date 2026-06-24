# Editor Consumer Guide

How to embed, theme, and wire the editor as a library. Contributor-facing internals live in `docs/design/editor/editor.md` and `adding-a-block.md`.

## Public API

Everything supported is re-exported from the barrel (`src/lib`). Adding an export is non-breaking; removing one is breaking — the surface is kept minimal and grows on demand.

| Group             | What you get                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Component**     | `Editor` — the Svelte component                                                                                                                               |
| **Props type**    | `EditorProps`, plus the resolve/policy types its fields reference                                                                                             |
| **CST utilities** | `parse` / `serialize` for round-tripping Markdown; `parseInline`, `getContentRange`, `isProseKind` for inspecting a block's inline content and editable range |
| **Node types**    | Block-kind and inline-node types for inspecting a parsed document                                                                                             |
| **Events types**  | The event-payload types the observer surface emits                                                                                                            |

### Component contract

`<Editor>` is controlled-by-prop-at-mount, read imperatively:

- **`source`** is read once at mount. An internal effect re-syncs the document if the prop changes; there is no two-way `bind:source` and no built-in save.
- **`bind:this`** exposes the consumer methods:
  - **`getSource()`** — serialize the live document back to Markdown.
  - **`getSelection()`** — a frozen snapshot of the current selection, or null when nothing is focused. Path arrays are copies.
  - **`getEvents()`** — the observer surface (see [Events](#events)).
  - **`getSearch()`** — the find/replace controller (see [Search](#search)).

The consumer owns load, save, and dirty-state. `editor.__test.*` is internal and test-only — not part of the contract.

### Mount example

```svelte
<script>
	import { Editor } from '$lib/editor';
	import '$lib/editor/styles/editor-theme.css';

	let editor;
</script>

<Editor bind:this={editor} source={'# Hello\n'} theme="dark" />
<button onclick={() => save(editor.getSource())}>Save</button>
```

`source` seeds the document at mount; read it back imperatively with `getSource()`.

## Multiple instances

Mounting two or more editors in one JavaScript context is supported. The boundary:

- **Schema is process-global.** The block grammar — block kinds, their components, openers, and commands — is one shared definition set per context (the `customElements` model: a kind is a definition every instance sees; registering the same kind twice is a conflict, not a per-instance override).
- **Runtime state is per-instance.** Every piece of mutable state an editor accumulates — selection, undo history, transient render caches — is scoped to that editor. Nothing one instance does to its own state reaches another.

So two editors share one grammar but never share state.

## Theming

The module owns its CSS. Two stylesheets ship under `styles/`:

- **`editor.css`** — structural painting rules. Auto-imported by the component; nothing to do.
- **`editor-theme.css`** — the default token palette (light + dark). Import it for the default look, or replace it wholesale to retheme. **It is the authoritative manifest** — read it for the exact token set and values rather than copying them here.

### Scope

Tokens are declared on the editor's own root (`.editor`), never on `:root` — the module does not inject custom properties into a consumer's global scope. To give the same palette to non-editor chrome (a surrounding toolbar, a placeholder editor), add the `limestone-editor-theme` class to a wrapper; it inherits the identical token set with no token declarations of your own.

### Light / dark

Mode keys on `data-editor-theme` on the scoped element. Set the `theme` prop on `<Editor>` (`'dark'` default, `'light'`, or any custom name); on a `.limestone-editor-theme` wrapper, set the attribute directly. Dark is the base — `'light'` overrides only the tokens that differ.

### Overriding and custom themes

Three paths, by scope:

1. **Override individual tokens** — declare them on `.editor` (or a narrower / your own selector) in a stylesheet loaded after `editor-theme.css`; custom properties cascade, so `.editor { --syntax-heading: #f90; }` wins. Per-mode: `.editor[data-editor-theme='light'] { … }`.
2. **Add a named theme** — define `.editor[data-editor-theme='solarized'] { … }` and pass `theme="solarized"`. The base block supplies fallbacks for any token the custom theme omits, so a partial theme overrides only what it names.
3. **Replace wholesale** — skip `editor-theme.css` and ship your own token file scoped to `.editor`.

### Token contracts

All tokens are editor-owned and shipped with light + dark values, so the module renders correctly host-less in both modes. Override any of them the same way — at `.editor` or a wrapper (never `:root`; see [Overriding](#overriding-and-custom-themes)).

| Group       | Tokens                                                                                                | Role                                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Content** | `--syntax-*`, `--code-tok-*`, `--font-editor`, `--md-*`, `--selection-overlay-bg`, `--search-match-*` | The editor's own visual language                                                                              |
| **Chrome**  | `--color-*`, `--radius-*`                                                                             | App-chrome flavored (bg/text/border/accent) — override to match your app palette; reads keep inline fallbacks |

## Behavior / policy props

Optional props customize URL/image handling and editor affordances:

| Prop               | Effect                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveImageUrl`  | Rewrite a raw image URL before it reaches `img.src` (e.g. resolve a relative path)                                                        |
| `resolveLinkUrl`   | Rewrite a raw link href at render time                                                                                                    |
| `imageLoadPolicy`  | `auto` (load images) or `placeholder` (defer loading)                                                                                     |
| `onLinkActivate`   | Handle a link click (Ctrl/Cmd+click or activation); replaces the default `window.open`                                                    |
| `blockDragHandles` | Toggle the mouse-only hover drag handle (default on); keyboard reorder (Alt+Arrow) is always available                                    |
| `searchBar`        | Toggle the in-document find/replace bar and its Ctrl+F / Ctrl+H shortcuts (default on)                                                    |
| `theme`            | Theme name reflected to `data-editor-theme` on the editor root; `'dark'` (default), `'light'`, or a custom name (see [Theming](#theming)) |

**Set-once at mount** — the `resolve*`, `imageLoadPolicy`, `onLinkActivate`, and `blockDragHandles` props. They thread to the renderer through context but are **not** folded into the prose render-memo key; a reactive post-mount swap renders stale, so set them at mount and treat them as fixed for the editor's lifetime. (Rationale: `docs/design/editor/editor.md`.) `theme` and `searchBar` are the exceptions — they read live and may change after mount.

## Events

Subscribe to the observer surface via `editor.getEvents()`. Three channels:

| Channel           | Fires                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `edit`            | After every commit (structural ops, the debounced typing flush, undo/redo)                    |
| `selectionChange` | Whenever the selection changes; payload is the snapshot or null                               |
| `error`           | On a failure the editor contains rather than propagates (subscriber / render / commit origin) |

Payload envelopes (the per-op arms change; read the source type rather than enumerating them here):

- **`EditEvent`** (`edit`) — `{ op, path, detail?, timestamp }`, discriminated by `op` (the operation kind). `detail` is the per-op payload defined in `schema/operations.ts`.
- **`SelectionChangeEvent`** (`selectionChange`) — the `EditorSelection` snapshot, or `null` when nothing is focused.
- **`EditorError`** (`error`) — `{ origin, error, context? }`, where `origin` is `subscriber | render | commit` and `context` carries the block path or op kind when known.

`on(name, cb)` returns a disposer; call it to unsubscribe. Events fire synchronously from their emission sites. **Handlers must not mutate the document** — reentrant edits are not supported.

## Search

`getSearch()` returns the imperative find/replace controller (`SearchState`) — the same engine the built-in bar drives. Use it to set the query and options (case sensitivity, whole-word, regex), step through matches, and replace one or all. The `searchBar` prop renders the built-in UI (Ctrl+F / Ctrl+H) over the same controller; set it `false` to drive search from your own chrome.

## Mutation-ceremony map

Every structural mutation routes through one internal commit primitive over three scopes, plus a separate undo/redo-apply path. A contributor reads this to see which path owns a given edit; consumers never assemble a ceremony themselves.

```
                       ┌─────────────────────────────┐
   split / merge /     │  Top-level scope            │
   delete / paste /    │  document children array    │──┐
   replaceBlock        └─────────────────────────────┘  │
                       ┌─────────────────────────────┐  │   one commit primitive:
   nested split /      │  Container scope            │  ├─▶ snapshot · unshare path ·
   merge / paste /     │  one container's children   │──┤   mutate · publish · emit `edit`
   item reorder        └─────────────────────────────┘  │
                       ┌─────────────────────────────┐  │
   cross-container     │  Multi-scope                │  │
   delete · indent /   │  several scopes, one step   │──┘
   unindent            └─────────────────────────────┘

                       ┌─────────────────────────────┐
   Ctrl+Z / Ctrl+Y     │  Undo/redo-apply            │ ── restores a snapshot;
                       │  (separate path)            │    emits `undo` / `redo` on `edit`
                       └─────────────────────────────┘
```

All three commit scopes share one primitive (snapshot, copy-path-on-write unshare, mutate, atomic publish, `edit` emit, `await tick()` before any post-tick focus callback). The undo/redo-apply path is separate: it restores a saved snapshot and emits `undo` / `redo` on the same `edit` channel. Full detail: `docs/design/editor/editor.md` § Commit Primitive / Event Seam.
