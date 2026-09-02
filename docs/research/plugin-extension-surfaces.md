# Plugin Extension Surfaces

Before deciding what our plugin system should do, I went and read everyone else's. This is what came back: what a plugin system has to expose, what the field quietly converges on, and where aragonite stands.

It's **evidence**, not a plan and not a contract. The shapes that freeze at 1.0 live in [plugin-contract.md](../design/plugin-contract.md); this doc is what they rest on.

Surveyed, on the supply side: ProseMirror, TipTap/Milkdown, BlockNote, Lexical, CodeMirror 6, Slate, Quill/Parchment, CKEditor 5, Editor.js, remark-directive, VS Code, Obsidian. The demand side (what plugin authors actually build) is read off Obsidian's most-installed community plugins.

1. [The finding](#the-finding): the two primitives every plugin ecosystem rests on, and which of them aragonite was actually missing.
2. [The convergent taxonomy](#the-convergent-taxonomy): what "add a plugin" means, system by system.
3. [Plugin-local state](#plugin-local-state-the-primitive-aragonite-does-not-need): the one primitive aragonite deliberately refuses, and the structural reason it can.
4. [What authors actually build](#what-authors-actually-build): plugin demand, classified by mechanism.
5. [Editable custom content](#editable-custom-content-three-archetypes): the three ways editors answer it, and the one to never copy.
6. [Freeze exposure](#freeze-exposure): which gaps can close after 1.0 without breaking anyone.
7. [The two plugin systems](#the-two-plugin-systems): where aragonite's plugins end and limestone's begin.

## The finding

Every mature editor plugin ecosystem rests on two primitives.

1. **Decorations**: annotate content the plugin does _not_ own. CodeMirror says it outright: "Decorations are the mechanism through which extensions can influence what the document looks like."
2. **Plugin-local state**: a slot the plugin owns, mapped forward through document changes (`StateField`, `PluginKey`, `addStorage`; the names differ, the slot doesn't).

ProseMirror's canonical guidance is literally these two composed: put the decoration set in your plugin's state and map it forward. TipTap's `addProseMirrorPlugins` escape hatch exists because decorations and plugin state can't be expressed in its declarative surface.

aragonite started from neither, and only one of them turned out to be a real gap. What it had instead was a third path: _own a kind and render it_ (a kind being the string on a node that says what block it is). That path it does better than the field, since plugin content here is editable in place, where Obsidian's codeblock plugins render read-only HTML into a preview. That's the moat.

- **Plugin-local state isn't a gap.** aragonite genuinely doesn't need it, for a structural reason (§ Plugin-local state). Don't copy `StateField`.
- **Decorations were one, until 0.9.22.** aragonite's model is "a plugin owns a kind"; the decoration model is "overlay view-only state onto ranges the plugin doesn't own". Everything that owns no syntax had no home before then: spellcheck squiggles, AI ghost text, inline comments, collaboration cursors, task-line badges, indent guides, backlink highlights. The decoration source (a pure `doc → Decoration[]`; § Plugin-local state says why pure is enough) closed the class.

The ordinary capabilities a plugin needs just to reach the document at all (the per-instance context of § What authors actually build) shipped one version earlier, in 0.9.21.

## The convergent taxonomy

What "add a plugin" means, across the field. Systems differ in ergonomics, not in content. The aragonite column names the actual calls, all from `@voithos-labs/aragonite/plugin`, so it reads the way the other columns do.

| Category               | ProseMirror / TipTap       | Lexical                       | CodeMirror 6    | Obsidian         | aragonite                                          |
| ---------------------- | -------------------------- | ----------------------------- | --------------- | ---------------- | -------------------------------------------------- |
| **Type / schema**      | `NodeSpec`, `Node.create`  | `ElementNode`/`DecoratorNode` | none            | none             | `declarePluginKind` + `registerBlockKind` ✅       |
| **Recognizer**         | `parseDOM`, input rules    | `ElementTransformer`          | Lezer grammar   | code fence       | `registerBlockOpener`, `registerDirective` ✅      |
| **Serializer**         | `toDOM`, `toMarkdown`      | `.export()`                   | (text is truth) | (text is truth)  | `rebuildRaw` ✅                                    |
| **View**               | `NodeView`                 | `createDOM`                   | `WidgetType`    | `toDOM`          | a Svelte component ✅                              |
| **Commands + keymap**  | Command + keymap           | `registerCommand`             | keymap facet    | `addCommand`     | `registerBlockCommand`, `registerGlobalCommand` ✅ |
| **Decorations**        | `Decoration`               | `decorate`                    | `Decoration`    | editor extension | `decorations.addSource` ✅                         |
| **Plugin-local state** | `StateField` / `PluginKey` | `addStorage`                  | `StateField`    | `addStorage`     | metadata on the node (§ Plugin-local state)        |
| **Clipboard / paste**  | `addPasteRules`            | none                          | none            | none             | `registerPasteTransform` ✅                        |

Two lessons the field agrees on, and aragonite already honors both:

- **One unit per kind beats three surfaces.** ProseMirror's split (schema + plugin array + nodeViews map) is the anti-pattern; TipTap exists to fold them back into one unit per kind. aragonite is already on the right side. Don't trade this away.
- **Register once, fail loud, namespace.** Every system that let a later registration silently replace an earlier one grew a chronic collision tax. aragonite throws on a duplicate registration.

One structural advantage worth naming: **input rules come free.** ProseMirror and TipTap need a whole subsystem so that typing syntax produces structure. aragonite re-parses the raw Markdown as you type, so typing the syntax _is_ the input rule.

## Plugin-local state: the primitive aragonite does not need

The taxonomy's state row is the one place a naive reading misleads. aragonite shouldn't grow a `StateField` / `addStorage` equivalent, and the reason is structural rather than taste.

**Half of the demand is already covered, and covered better.** State that belongs to a _node_ goes on the node, in its metadata. That metadata rides along into undo snapshots, so it undoes and redoes for free (ProseMirror makes you map plugin state forward through every transaction by hand), and if it feeds `rebuildRaw` (the per-kind function that re-emits a container's bytes from its children and metadata) it reaches the disk for free as well. Mermaid's diagram source lives exactly there. One constraint: metadata values are primitives, or flat arrays of primitives, because the undo clone copies one level deep (invariant G1.6).

**The other half evaporates.** The dominant use of a `StateField` in ProseMirror and CodeMirror is holding a **decoration set and mapping it forward through changes**. They need that because a position is an integer into one flat sequence: type one character near the top and every cached position below it is stale, so the set has to be re-mapped on every transaction. That mapping problem is what forces the state slot to exist.

aragonite has no such problem. A position is a path plus an offset (the path being the child indices from the document root down to the block), into a tree re-derived from the raw Markdown on each edit, so there's nothing to map forward. A decoration source is a **pure function `doc → Range[]`**, recomputed or memoized on change, never a mapped-forward field. The proof already ships twice: search runs as a decoration source (its scan _is_ that pure function), and the highlight-occurrences plugin is a second client.

**So the shape is three primitives, and no state API at all.** They shipped in 0.9.21 as the per-instance `EditorContext` an `onEditor` callback receives:

| Give a plugin                                        | And it can                                            |
| ---------------------------------------------------- | ----------------------------------------------------- |
| the **document** (a live getter)                     | compute anything derived from it                      |
| an **editor identity** (`editorId`)                  | key its own `Map`: per-instance state, config, caches |
| a **change signal** (the subscribe-only events view) | invalidate that cache                                 |

(The context has since grown more read surfaces: the decoration registry, the rect API, presentation mode, theme. The state story is still these three rows.)

With those, a plugin builds whatever state it wants, and the platform stores nothing and owns no lifecycle: nothing to leak, reset, or get wrong on undo. Same instinct as the rest of the editor (dependencies explicit, derive rather than cache, no runtime patching). The doc-stats fixture, a plugin kept in the dev harness that counts an editor's blocks and edits off exactly this surface, is the working proof.

Copying `StateField` would be importing a solution to a problem this architecture doesn't have.

## What authors actually build

Obsidian's most-installed plugins, classified by _mechanism_ rather than feature. The denominator first: roughly half never touch the editing surface at all. (limestone, in the last column, is the note app aragonite ships inside; § The two plugin systems draws the full line.)

| Layer                        | Examples                                              | Whose problem   |
| ---------------------------- | ----------------------------------------------------- | --------------- |
| **App shell**                | sync, git, calendar, quick-capture, theme settings    | limestone's     |
| **Alternate view of a file** | Kanban, Excalidraw                                    | limestone's     |
| **Editing surface**          | Dataview, Tasks, Templater, Outliner, Advanced Tables | **aragonite's** |

Of those that touch the editing surface, by share of that set:

| Mechanism                                                           | Share                                                  | aragonite                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| **Document mutation** (insert at caret, reformat a region, rewrite) | over half                                              | **gap**: a command can only write metadata on its own node         |
| **Decorations**                                                     | ~half                                                  | **have**: a pure per-instance decoration source                    |
| **A custom block kind** from custom syntax                          | ~a third                                               | **have, best in class**                                            |
| **Document lifecycle** (on load / change / save)                    | ~a third                                               | **have**: `onEditor` plus the per-instance events view             |
| **Single-document derived state** (ToC, footnote numbering)         | smaller share, but the two largest plugins by installs | **have**: `BlockComponentProps.document` (the toc plugin reads it) |
| **Context-sensitive keymap** (Tab means "next cell" inside a table) | smaller share, but the two most-loved editing plugins  | **have**                                                           |
| **Trigger-character suggest** (`/`, `@`, `[[`)                      | table stakes                                           | **gap**                                                            |

The custom-block-kind row is the one to sit with. It's the mechanism aragonite is _strongest_ at, and it's a third of the demand. Being excellent at a third of the demand isn't a platform.

## Editable custom content: three archetypes

Every editor answers "custom content that is itself editable" one of three ways, and only one of them was ever open to aragonite.

| Archetype                                                                                                 | Who                 | Verdict for aragonite                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **contentDOM / NodeView**: the editor owns an editable hole whose children are real nodes in the one tree | ProseMirror, TipTap | **Adopted.** The nested block list a container factory renders _is_ the contentDOM. The crown jewel.                                   |
| **Nested editor**: the editable interior is a separate editor state serialized as an opaque blob          | Lexical, CM6        | **Rejected permanently.** A parallel source of truth that can't round-trip byte for byte. The single most important thing not to copy. |
| **Decorations**: view-only overlays; "editing" reveals hidden source                                      | CM6, Obsidian       | **Presentational only.** Never enters the tree. Exposed as a pure per-instance decoration source.                                      |

One validated result worth keeping. Model a container's editable chrome (the parts of a block that are furniture rather than content: a callout title, a `<details>` summary) as a **reserved child-0 leaf inside the container's own child list**, and native cross-block selection into that chrome comes _for free_: caret, selection and undo all reach it with no changes to the core selection layer. The alternative (chrome as metadata behind a bounded field surface) would have made click-type-blur a permanent ceiling. That's why the chrome-leaf tier is shaped the way it is.

## Freeze exposure

The question that decides what has to be built _before_ 1.0 rather than after: would closing each gap later be **additive** (a new export, a new optional field, a new registry) or **breaking** (a change to a shape a plugin already binds to)?

Every gap above is additive but one, so the 1.0 freeze is safe. Safe isn't complete, though.

The exception was **the shape of a command's context**. A command may only write metadata on its own focused node. If document mutation later arrived as a _different_ context object rather than as fields on the existing one, every handler signature already bound to it would break.

Both shapes that wanted deciding were decided, and built, in 0.9.21:

- **A command's context grows by fields.** `BlockCommandContext.editor` landed as the proof, and the contract pins that document mutation arrives as further fields on that same object. (Field _names_ for mutation stay deliberately unpinned: naming unbuilt semantics would be guessing at a bound shape. The growth path is what's frozen.)
- **A plugin's setup context.** `setup(ctx)` plus `ctx.onEditor` deliver the per-instance `EditorContext` (document, identity, subscribe-only events, options), and a global command's handler reaches the _same_ object. One context, verified by construction rather than by discipline.

## The two plugin systems

There will be two, and the boundary has to be stated, or the app half reads as a hole in the editor half.

| Layer                 | Owns                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| **aragonite plugins** | The document and the editing surface: kinds, grammar, decorations, commands over the document, presentation |
| **limestone plugins** | The app: ribbon, sidebar, status bar, settings tabs, modals, palette UI, the vault, sync                    |

Obsidian conflates the two only because it _is_ the app. An editor library that grows a ribbon API has lost the plot. Vault-wide indexing is limestone's too; the editor supplies the raw material (an event stream and a parser), not the index.

The line isn't "editor = view". _Single-document_ derived state (a table of contents, footnote numbering, the tasks in this note) is the editor's, because it's a function of the one document the editor owns.

## Sources

Obsidian plugin statistics and API (`registerEditorExtension`, `registerMarkdownPostProcessor`, `EditorSuggest`) · CodeMirror 6 system guide and decoration examples · ProseMirror guide (plugin state, decorations) · TipTap extension API · BlockNote `createBlockSpec` · Slate void nodes and `normalizeNode` · Quill/Parchment blot registry · CKEditor 5 schema · Editor.js block-tool API (`pasteConfig`, `conversionConfig`) · remark-directive / mdast-util-directive.
