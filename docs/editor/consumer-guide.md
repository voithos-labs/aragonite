# Editor Consumer Guide

How to embed, theme, and wire the editor as a library. Contributor-facing internals live in `docs/design/editor/editor.md` and `adding-a-block.md`.

## Public API

Everything supported is re-exported from the barrel (`src/lib/editor`). Adding an export is non-breaking; removing one is breaking — the surface is kept minimal and grows on demand.

| Group             | What you get                                                                        |
| ----------------- | ----------------------------------------------------------------------------------- |
| **Component**     | `Editor` — the Svelte component                                                     |
| **Props type**    | `EditorProps`, plus the resolve/policy types its fields reference                   |
| **CST utilities** | `parse` / `serialize` for round-tripping Markdown; inline helpers for preprocessing |
| **Node types**    | Block-kind and inline-node types for inspecting a parsed document                   |
| **Events types**  | The event-payload types the observer surface emits                                  |

### Component contract

`<Editor>` is controlled-by-prop-at-mount, read imperatively:

- **`source`** is read once at mount. An internal effect re-syncs the document if the prop changes; there is no two-way `bind:source` and no built-in save.
- **`bind:this`** exposes the consumer methods:
  - **`getSource()`** — serialize the live document back to Markdown.
  - **`getSelection()`** — a frozen snapshot of the current selection, or null when nothing is focused. Path arrays are copies.
  - **`getEvents()`** — the observer surface (see [Events](#events)).

The consumer owns load, save, and dirty-state. `editor.__test.*` is internal and test-only — not part of the contract.

## Theming

The module owns its CSS. Two stylesheets ship under `styles/`:

- **`editor.css`** — structural painting rules. Auto-imported by the component; nothing to do.
- **`editor-theme.css`** — the default token palette, for both modes. Import it for the default look, or replace it wholesale to retheme.

Tokens split into two contracts. **`editor-theme.css` is the authoritative manifest** — read it for the exact set and values rather than copying them here.

| Contract          | Tokens                                                                            | Owner                                                   |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Editor-owned**  | `--syntax-*`, `--code-tok-*`, `--font-editor`, `--selection-overlay-bg`, `--md-*` | Declared by the module; override at `:root` or narrower |
| **Host-provided** | `--color-*`, `--radius-*`                                                         | Read with fallbacks; the module never declares them     |

Light and dark palettes key on `:root[data-theme-type='light']` — toggle that attribute as the host does. Host tokens are read-with-fallback so a consumer that omits them still renders.

## Resolve / policy props

Four optional props customize how URLs and images are handled:

| Prop              | Effect                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| `resolveImageUrl` | Rewrite a raw image URL before it reaches `img.src` (e.g. resolve a relative path)     |
| `resolveLinkUrl`  | Rewrite a raw link href at render time                                                 |
| `imageLoadPolicy` | `auto` (load images) or `placeholder` (defer loading)                                  |
| `onLinkActivate`  | Handle a link click (Ctrl/Cmd+click or activation); replaces the default `window.open` |

**Set-once at mount.** These thread to the renderer through context but are **not** folded into the prose render-memo key. A reactive post-mount swap renders stale — set them at mount and treat them as fixed for the editor's lifetime. (Rationale: `docs/design/editor/editor.md`.)

## Events

Subscribe to the observer surface via `editor.getEvents()`. Three channels:

| Channel           | Fires                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `edit`            | After every commit (structural ops, the debounced typing flush, undo/redo)                    |
| `selectionChange` | Whenever the selection changes; payload is the snapshot or null                               |
| `error`           | On a failure the editor contains rather than propagates (subscriber / render / commit origin) |

`on(name, cb)` returns a disposer; call it to unsubscribe. Events fire synchronously from their emission sites. **Handlers must not mutate the document** — reentrant edits are not supported.

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
