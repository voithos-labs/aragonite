# Plugin Extension Surfaces

What a plugin system has to expose, what the field converges on, and where aragonite stands.

This is **evidence**, not a plan and not a contract. The plan is `docs/roadmap.md`; the shapes that freeze at 1.0 are `docs/design/plugin-contract.md`. This doc is what those two rest on.

Surveyed: ProseMirror, TipTap/Milkdown, BlockNote, Lexical, CodeMirror 6, Slate, Quill/Parchment, CKEditor 5, Editor.js, remark-directive, VS Code, Obsidian. Demand evidence from Obsidian's most-installed community plugins.

## The finding

**Every mature editor plugin ecosystem rests on two primitives:**

1. **Decorations** — annotate content the plugin does _not_ own. CodeMirror says it outright: "Decorations are the mechanism through which extensions can influence what the document looks like."
2. **Plugin-local state** — a slot the plugin owns, mapped forward through document changes (`StateField`, `PluginKey`, `addStorage`).

ProseMirror's canonical guidance is literally these two composed: put the decoration set in your plugin's state and map it forward. TipTap's `addProseMirrorPlugins` escape hatch exists _specifically_ because decorations and plugin state cannot be expressed in its declarative surface.

**aragonite started from neither — but only one of them was a real gap.** It exposes a third path instead: _own a kind and render it_, which it does better than the field, since plugin content is genuinely editable and byte-lossless where Obsidian's codeblock plugins render read-only HTML into a preview. That is the moat, and it is real.

- **Plugin-local state is not a gap.** aragonite genuinely does not need it, for a structural reason — see the section below. Do not copy `StateField`.
- **Decorations were — until 0.9.22.** aragonite's model is "CST is truth, a plugin owns a kind"; the decoration model is "overlay view-only state onto ranges the plugin doesn't own." Everything that owns no syntax had no home until then: spellcheck squiggles, AI ghost text, inline comments, collaboration cursors, task-line badges, indent guides, backlink highlights. The decoration source (a pure `doc → Decoration[]`, § below) closed the class.

**The one real hole was decorations — closed in 0.9.22.** The ordinary capabilities a plugin needs to reach the document at all — the context spine of § What authors actually build — shipped in 0.9.21.

## The convergent taxonomy

What "add a plugin" means, across the field. Systems differ in ergonomics, not in content.

| Category               | ProseMirror / TipTap       | Lexical                       | CodeMirror 6    | Obsidian         | aragonite                     |
| ---------------------- | -------------------------- | ----------------------------- | --------------- | ---------------- | ----------------------------- |
| **Type / schema**      | `NodeSpec`, `Node.create`  | `ElementNode`/`DecoratorNode` | —               | —                | descriptor + kind mint ✅     |
| **Recognizer**         | `parseDOM`, input rules    | `ElementTransformer`          | Lezer grammar   | code fence       | block opener, directive ✅    |
| **Serializer**         | `toDOM`, `toMarkdown`      | `.export()`                   | (text is truth) | (text is truth)  | `rebuildRaw` ✅ byte-lossless |
| **View**               | `NodeView`                 | `createDOM`                   | `WidgetType`    | `toDOM`          | Svelte component ✅           |
| **Commands + keymap**  | Command + keymap           | `registerCommand`             | keymap facet    | `addCommand`     | per-kind + global ✅          |
| **Decorations**        | `Decoration`               | `decorate`                    | `Decoration`    | editor extension | decoration source ✅          |
| **Plugin-local state** | `StateField` / `PluginKey` | `addStorage`                  | `StateField`    | `addStorage`     | per-node metadata — see below |
| **Clipboard / paste**  | `addPasteRules`            | —                             | —               | —                | content-keyed transform ✅    |

Two structural lessons the field agrees on, both of which aragonite already honors:

- **A cohesive per-kind unit beats fragmentation.** ProseMirror's three separate surfaces (schema + plugin array + nodeViews map) is the anti-pattern; TipTap exists to collapse it back into one unit per kind. aragonite is already on the right side — do not trade this away.
- **Register-once, fail-loud, namespaced.** Every system that used silent last-writer-wins for its declarative layer grew a chronic collision tax. aragonite throws on duplicate registration.

One structural advantage worth naming: **input rules come free.** ProseMirror and TipTap need a whole subsystem so that typing syntax produces structure. aragonite parses continuously over raw Markdown, so typing the syntax _is_ the input rule.

## Plugin-local state — the primitive aragonite does not need

The taxonomy's state row is the one place a naive reading misleads. aragonite should **not** grow a `StateField` / `addStorage` equivalent, and the reason is structural rather than a preference.

**Half of it is already covered, and covered better.** State that belongs to a _node_ goes on the node. Per-node metadata is cloned into undo snapshots, so it undoes and redoes for free — where ProseMirror makes you map plugin state forward through every transaction by hand — and if it feeds `rebuildRaw`, it round-trips to disk for free as well. Mermaid's diagram source lives there and comes back byte-exact. The one constraint: metadata holds primitives only, because the undo clone is shallow (invariant G1.6).

**The other half evaporates.** The dominant use of a `StateField` in ProseMirror and CodeMirror is holding a **decoration set and mapping it forward through changes**. They need that because a position is an integer into a flat sequence: type one character near the top and every cached position below it is stale, so the set must be re-mapped on every transaction. _That mapping problem is what forces the state slot to exist._

aragonite has no such problem. A position is a `(path, offset)` into a CST re-derived from raw on each edit — there is nothing to map forward. A decoration source is therefore a **pure function `doc → Range[]`**, recomputed or memoized on change, not a mapped-forward field. The proof already ships: search runs as a decoration source (its scan _is_ that pure function), and the highlight-occurrences plugin is a second client.

**So the shape is three primitives, and no state API at all — shipped in 0.9.21 as the per-instance `EditorContext` an `onEditor` callback receives:**

| Give a plugin                                        | And it can                                             |
| ---------------------------------------------------- | ------------------------------------------------------ |
| the **document** (a live getter)                     | compute anything derived from it                       |
| an **editor identity** (`editorId`)                  | key its own `Map` — per-instance state, config, caches |
| a **change signal** (the subscribe-only events view) | invalidate that cache                                  |

With those, a plugin builds whatever state it wants and **the platform stores nothing and owns no lifecycle** — nothing to leak, reset, or get wrong on undo. It is the same instinct as the rest of the editor: dependencies explicit, derive rather than cache, no runtime patching. The doc-stats dogfood is the working proof.

Copying `StateField` would be importing a solution to a problem this architecture does not have.

## What authors actually build

Obsidian's most-installed plugins, classified by _mechanism_ rather than feature. State the denominator first: roughly half never touch the editing surface at all.

| Layer                        | Examples                                              | Whose problem   |
| ---------------------------- | ----------------------------------------------------- | --------------- |
| **App shell**                | sync, git, calendar, quick-capture, theme settings    | limestone's     |
| **Alternate view of a file** | Kanban, Excalidraw                                    | limestone's     |
| **Editing surface**          | Dataview, Tasks, Templater, Outliner, Advanced Tables | **aragonite's** |

Of those that touch the editing surface, by share of that set:

| Mechanism                                                           | Share                                                  | aragonite                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| **Document mutation** (insert at caret, reformat a region, rewrite) | over half                                              | **gap** — commands write metadata on their own node only |
| **Decorations**                                                     | ~half                                                  | **have** — a pure per-instance decoration source         |
| **A custom block kind** from custom syntax                          | ~a third                                               | **have — best in class**                                 |
| **Document lifecycle** (on load / change / save)                    | ~a third                                               | **have** — `onEditor` + the per-instance events view     |
| **Single-document derived state** (ToC, footnote numbering)         | smaller share, but the two largest plugins by installs | **have** — `BlockComponentProps.document` (toc dogfood)  |
| **Context-sensitive keymap** (Tab means "next cell" inside a table) | smaller share, but the two most-loved editing plugins  | **have**                                                 |
| **Trigger-character suggest** (`/`, `@`, `[[`)                      | table stakes                                           | **gap**                                                  |

The custom-block-kind row is the one to sit with: it is the mechanism aragonite is _strongest_ at, and it is third. Being excellent at a third of the demand is not a platform.

## Editable custom content — three archetypes

Every editor answers "custom content that is itself editable" one of three ways. aragonite's answer is forced by CST-truth plus byte-lossless round-trip.

| Archetype                                                                                              | Who                 | Verdict for aragonite                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **contentDOM / NodeView** — editor owns an editable hole whose children are real nodes in the one tree | ProseMirror, TipTap | **Adopted.** The nested `BlockList` inside a container factory _is_ the contentDOM. The crown jewel.                                    |
| **Nested editor** — the editable interior is a separate editor state serialized as an opaque blob      | Lexical, CM6        | **Rejected permanently.** A parallel source of truth that cannot round-trip byte-for-byte. The single most important thing not to copy. |
| **Decorations** — view-only overlays; "editing" reveals hidden source                                  | CM6, Obsidian       | **Presentational only.** Must never enter the CST. Exposed as a pure per-instance decoration source.                                    |

A validated result worth keeping: modelling editable container chrome (a callout title, a `<details>` summary) as a **reserved child-0 leaf inside the container's own child list** gives native cross-block selection into that chrome _for free_ — the caret, selection, and undo all reach it with no changes to the core selection layer. The alternative (chrome as metadata behind a bounded field surface) would have made click-type-blur a permanent ceiling. This is why the chrome-leaf tier is shaped the way it is.

## Freeze exposure

The question that decides what must be built _before_ 1.0 rather than after: would closing each gap later be **additive** (a new export, a new optional field, a new registry) or **breaking** (a change to a shape a plugin already binds to)?

**Every gap above is additive but one.** New registries, new optional descriptor fields, and new fields on payloads a plugin _receives_ break no bound shape. **The 1.0 freeze is safe.** It is not complete — and those are different claims, which is the whole point of stating this.

The exception was **the shape of a command's context**. A command may only write metadata on its own focused node; if document mutation later arrived as a _different_ context object rather than as fields on the existing one, every handler signature already bound to it would break.

Both shapes that wanted deciding were decided — and built — in 0.9.21:

- **A command's context** grows by fields: `BlockCommandContext.editor` landed as the proof, and the contract pins that mutation arrives as further fields on the same object. (Field _names_ for mutation stay deliberately unpinned — naming unbuilt semantics would guess at a bound shape; the growth path is what's frozen.)
- **A plugin's setup context.** `setup(ctx)` + `ctx.onEditor` deliver the per-instance `EditorContext` (document, identity, subscribe-only events, options), and a global command's handler receives the _same_ object — one context, verified by construction, not by discipline.

## The two plugin systems

There will be two, and the boundary has to be stated or the app half reads as a hole in the editor half.

| Layer                 | Owns                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **aragonite plugins** | The document and the editing surface: kinds, grammar, decorations, commands over the document, presentation |
| **limestone plugins** | The app: ribbon, sidebar, status bar, settings tabs, modals, palette UI, the vault, sync                    |

Obsidian conflates the two only because it _is_ the app. An editor library that grows a ribbon API has lost the plot. Vault-wide indexing is limestone's too — the editor supplies the raw material (an event stream and a parser), not the index.

The line is not "editor = view." _Single-document_ derived state — a table of contents, footnote numbering, tasks in this note — is the editor's, because it is a function of the one document the editor owns.

## Sources

Obsidian plugin statistics and API (`registerEditorExtension`, `registerMarkdownPostProcessor`, `EditorSuggest`) · CodeMirror 6 system guide and decoration examples · ProseMirror guide (plugin state, decorations) · TipTap extension API · BlockNote `createBlockSpec` · Slate void nodes and `normalizeNode` · Quill/Parchment blot registry · CKEditor 5 schema · Editor.js block-tool API (`pasteConfig`, `conversionConfig`) · remark-directive / mdast-util-directive.
