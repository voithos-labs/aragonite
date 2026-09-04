# Plugin API Reference

Every export of `@voithos-labs/aragonite/plugin`, grouped by job, so you can find a name and what it does without reading the package's entry module. Nobody reads this page top to bottom; Ctrl+F your way to the name you're after. The recipes behind the names live in the [plugin guide](plugin-guide.md), and each group links to its section there.

## API reference

Values are the calls you make, and the types beside them describe what those calls take and hand back.

Five words recur in every table, so here they are once:

- A **kind** is aragonite's word for a block type. Paragraph is a kind, fenced code is a kind, your plugin's block is about to be one.
- A block's **raw** is its exact source bytes, and saving a document is just concatenating them.
- An **opener** is the piece of the parser that recognizes the line a block starts with.
- A **leaf** is a block with no child blocks; a **container** holds other blocks.
- To **mint** is to create a branded, registry-backed identity (a kind, a command id) in the one authorized place; a duplicate throws.

A group tagged _(pre-freeze / unstable)_ may still change shape until the 1.0 freeze; an untagged group already holds its final shape. The tags copy the section notes in the entry module (`src/lib/plugin.ts`).

Adding an export? Give it a row in its group, tagged the way its entry-module section is tagged. A test (`src/lib/test/plugins/plugin-guide-coverage.test.ts`) diffs this page against the entry module and fails naming any export without a row. It finds the catalog by the exact `## API reference` heading above, so if you rename the heading, rename it there too.

The groups, in page order:

| Group                                                   | What it covers                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [The plugin unit](#the-plugin-unit)                     | Packaging your extension, installing it, and what each mounted editor hands it back          |
| [Kind declaration](#kind-declaration)                   | Minting a new block type's identity                                                          |
| [The block-kind descriptor](#the-block-kind-descriptor) | Telling the editor how your block type behaves, and the checklist every one must fill in     |
| [The component registry](#the-component-registry)       | Binding a block type to the Svelte component that renders it                                 |
| [The parser opener](#the-parser-opener)                 | Teaching the parser to recognize your block's syntax                                         |
| [Enter completion](#enter-completion)                   | Letting one typed line become a construct whose lines must sit together                      |
| [Registration probes](#registration-probes)             | Checking what's already registered, so a module that runs twice stays safe                   |
| [Directive authoring](#directive-authoring)             | Owning a `:::name` block without writing your own parsing                                    |
| [Container authoring](#container-authoring)             | Blocks that hold other blocks, plus their title line                                         |
| [Editable-leaf authoring](#editable-leaf-authoring)     | A text-editing block with the editor's own caret, undo, and selection                        |
| [Inline authoring](#inline-authoring)                   | Your own syntax inside a paragraph, rendered as a widget                                     |
| [Commands and keybindings](#commands-and-keybindings)   | Keyboard shortcuts and commands, per block type or editor-wide                               |
| [Paste transforms](#paste-transforms)                   | Rewriting pasted text before the editor parses it                                            |
| [Decorations](#decorations)                             | View-only annotations over content your plugin does not own                                  |
| [Rects](#rects)                                         | Where things are on screen: block boxes, ranges, the caret, scrolling to a block             |
| [Selection geometry](#selection-geometry)               | The shapes that describe what the user has selected                                          |
| [Parse and serialize](#parse-and-serialize)             | Markdown in, tree out, and back again                                                        |
| [Grammar scanners](#grammar-scanners)                   | The editor's own code-fence, HTML-tag, and blockquote rules, reusable so you never fork them |
| [Node access and metadata](#node-access-and-metadata)   | Reading the document tree, and storing your own data on a block                              |
| [Performance helpers](#performance-helpers)             | A small cache and a scan index for render and recognition work                               |

### The plugin unit

_(pre-freeze / unstable)_ The installable package, and the per-editor context it gets back. Wiring and the traps: [The plugin unit](plugin-guide.md#the-plugin-unit) and [One process, many editors](plugin-guide.md#one-process-many-editors).

| Export               | Role                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `definePlugin`       | Validate a `{ name, setup }` unit at definition time and return it, ready for the editor's `plugins` prop                                                                                                           |
| `definePluginBlock`  | The single-block shortcut: one kind, one component, one register step, packaged as a unit                                                                                                                           |
| `isPluginInstalled`  | Has a plugin of this name installed? For the rare setup that has to branch on it                                                                                                                                    |
| `EditorPlugin`       | The unit's shape; the `plugins` prop and the main entry's `installPlugins` take these                                                                                                                               |
| The `plugins` prop   | Installs once per process, and activates per editor: an editor runs the hooks, kinds, commands and paste transforms of exactly the plugins it lists (no prop at all activates every installed one)                  |
| `EditorPluginEntry`  | One `plugins` prop entry: a bare unit, or `{ plugin, options }` to vary options per editor                                                                                                                          |
| `PluginSetupContext` | What `setup(ctx)` receives; its `onEditor(cb)` registers a per-editor callback (call it from `setup`, synchronously)                                                                                                |
| `OnEditorCallback`   | The callback itself: receives the `EditorContext` of each mounted editor that listed your plugin, may return a cleanup function the editor runs at unmount                                                          |
| `EditorContext`      | One editor's view for your plugin: `editorId`, the live read-only `document`, subscribe-only `events`, this editor's `options`, its `decorations` and `rects` surfaces, and the live `presentationMode` and `theme` |
| `PresentationMode`   | The union of the editor's view modes (source, reading, the previews, live); every mode read reports the effective one, meaning the mode actually in force. [Presentation modes](plugin-guide.md#presentation-modes) |

### Kind declaration

Every kind starts here. No other call accepts a bare string where a kind goes.

| Export                            | Role                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `declarePluginKind`               | Mint a block kind from a name and get the kind back; a collision with a built-in or a prior kind throws |
| `declaredPluginKind`              | Recover an already-declared kind in another module, no cast; throws for a name nobody declared          |
| `PluginBlockKind`, `AnyBlockKind` | The plugin-declared kind type, and the union of built-in and plugin kinds a node can carry              |

### The block-kind descriptor

The **descriptor** is a kind's written behavior: how it merges, whether it's editable, its container shape. Its required `closure` field is the kind's answer to each cross-cutting editor system (undo, search, selection, clipboard and friends), so a new kind can't ship silently broken under a subsystem nobody asked about. Cell by cell: [The closure block](plugin-guide.md#the-closure-block).

| Export                                         | Role                                                                                                                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockKind`                            | Register a kind's descriptor; the kind errors at first use without one                                                                                                                                |
| `augmentBlockKind`                             | Merge extra fields into a kind your own plugin registered; built-in kinds and another plugin's kinds are refused with a throw                                                                         |
| `BlockKindRegistration`, `BlockKindDescriptor` | What `registerBlockKind` accepts, and the flat read-side shape lookups hand back                                                                                                                      |
| `BlockKindAugmentation`                        | The patch `augmentBlockKind` merges; a partial `container` group merges into the existing one                                                                                                         |
| `ContainerDescriptorGroup`                     | The descriptor's container-only half: `rebuildRaw` (the hook that recomputes a container's raw from its children after an edit), the body wrap, the reserved title line, unwrap behavior              |
| `MergeRole`, `UnwrapRole`                      | Closed sets naming how a kind merges on Backspace, and how a container releases a child at its edge                                                                                                   |
| `ChildRawChange`                               | `rebuildRaw`'s optional second argument: which one child's bytes just moved, for a rebuilder that re-emits only that region. Ignoring it and re-deriving the whole raw is always correct, just slower |
| `ClosureBlock`, `ClosureColumn`, `ClosureCell` | The closure matrix: nine columns, one cell each, and a cell is `implemented` (name the mechanism), `inherit-default`, or `not-supported` (name the degradation). A missing column fails the typecheck |
| `simpleLeafClosure`, `SimpleLeafClosureCells`  | Closure preset for a plain text leaf: bakes the five cells every such leaf answers alike, requires the four your component determines (`focus`, `searchPaint`, `undo`, `simOracle`)                   |
| `containerClosure`, `ContainerClosureCells`    | Closure preset for a container of real child blocks: bakes the four structural cells plus `roundTrip: implemented`, requires the round trip's `via` string and the four the container determines      |

### The component registry

| Export                                    | Role                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockComponent`                  | Bind a kind to the Svelte component that renders it; without one the kind renders as a visible raw-text fallback (you'll notice) |
| `defineBlockComponent`                    | Wrap your component into the registry's entry shape; a container that forgot to publish its API fails the typecheck here         |
| `BlockComponentEntry`                     | The registry entry: the component, plus an optional per-node extra-props hook                                                    |
| `BlockComponent`, `BlockComponentExports` | The surface a block component publishes: a leaf's own members, or a container's single `containerApi` export                     |
| `BlockComponentProps`                     | The props every block component receives: its node, its position, the read-only whole document, the editor's geometry surface    |

### The parser opener

Where your opener sits on the ladder, and the two placement rules: [Opener priority](plugin-guide.md#opener-priority).

| Export                                   | Role                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockOpener`                    | Teach the parser to recognize your kind's Markdown syntax                                                                                                                                                             |
| `BlockOpener`, `OpenContext`             | The opener contract, and the line cursor its `tryOpen` inspects: the lines, the position, the parse's scope and depth                                                                                                 |
| `BlockOpenerResult`                      | A claim: the node built, plus `consumed`, the count of lines it took                                                                                                                                                  |
| `OPENER_PRIORITIES`                      | The built-in priorities your opener picks its own number relative to; lower dispatches first _(pre-freeze / unstable)_                                                                                                |
| `lineStartsOuterBlock`, `OuterBlockScan` | "Does this line start a block at the outer level?" The shared end-of-extent test for a container opener scanning its own lines, and its input flag saying whether a paragraph is open above _(pre-freeze / unstable)_ |

### Enter completion

_(pre-freeze / unstable)_ The recipe: [Typing a multi-line construct into existence](plugin-guide.md#typing-a-multi-line-construct-into-existence).

| Export                   | Role                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockCompleter` | Let one typed line complete into a grammar whose lines must sit adjacent, which Enter alone can never type                              |
| `BlockCompleter`         | The contract: `tryComplete(line)` claims with a result, or declines with null                                                           |
| `CompletionResult`       | A claim: the lines to insert, endings omitted (the editor attaches the document's own), plus where the caret seats inside the insertion |

### Registration probes

Every registry on this surface is register-once (a duplicate throws, it never overrides). These are the matching is-it-there checks, for a module that may run twice (hot reload, a re-import) to ask before registering. Guard on these rather than on a module-level flag of your own: the flag outlives the test kit's platform reset, and the guide's registration section tells you how that afternoon goes. The directive and inline tiers keep their own probes, `isDirectiveRegistered` and `isInlineKindDeclared`, in their groups below.

| Export                                                                                                         | Role                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `isBlockKindDeclared`                                                                                          | Is this kind name already declared?                |
| `isBlockKindRegistered`, `isBlockComponentRegistered`, `isBlockOpenerRegistered`, `isBlockCompleterRegistered` | One guard per register-once call on the block side |
| `isPasteTransformRegistered`                                                                                   | The same guard, keyed by a paste transform's name  |

### Directive authoring

_(pre-freeze / unstable)_ The `:::name` grammar itself is the [directives guide](directives.md)'s subject; the worked container is [the walkthrough](plugin-guide.md#walkthrough-a-conspiracy-container-end-to-end).

| Export                                                   | Role                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activateDirectives`                                     | Turn the `:::name` grammar on, once at startup, before the first parse; every other export here is inert until it runs                                                        |
| `registerDirective`                                      | Map a `(tier, name)` pair to one of your kinds; a container mapping must bring its node factory (`fromDirective`), or registration throws                                     |
| `isDirectiveRegistered`                                  | The is-it-there check for a directive name                                                                                                                                    |
| `parseDirectiveAttributes`                               | Opt-in reader pulling a `[label]` and a `{#id .class key=val}` block out of a directive's info string; one-way, it reads and never writes back                                |
| `serializeDirective`                                     | Re-emit a directive's exact bytes from its parts (colon count, name, verbatim info string, body, closer shape), growing the fences itself so no body line reads as the closer |
| `escalatedColonCount`                                    | The fence length a body forces, for an emitter building `:::name` text by hand instead of through `serializeDirective`                                                        |
| `createDirectiveRebuild`                                 | Build the raw-recompute hook (`rebuildRaw`) for a directive container whose child 0 is an editable title; owns the fence bytes, CRLF included                                 |
| `DIRECTIVE_BODY_WRAP`                                    | The wrap every `:::` body parses with; declare it as your container kind's `bodyWrap` so a blank line against the fence settles where it belongs                              |
| `DirectiveDefinition`, `ParsedDirective`                 | The registration's shape, and the parsed fence your factory receives: the fence parts, the parsed body, the exact consumed bytes                                              |
| `DirectiveTier`, `DirectiveFence`, `DirectiveAttributes` | The three tiers (container, leaf, text), one parsed opener line, and what the attribute reader returns                                                                        |

### Container authoring

_(pre-freeze / unstable)_ A container's **chrome** is its own furniture: the border, the title line, an icon if you like. The factory hides everything else (child-list state, ancestor wiring, the mounting of only what's visible), so your component only has to supply the chrome. Worked end to end in [the walkthrough](plugin-guide.md#walkthrough-a-conspiracy-container-end-to-end).

| Export                                          | Role                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createContainerBlock`                          | Wire a nested-child-list container so your component is as thin as the built-in blockquote's                                                                                                                       |
| `BlockList`                                     | The child-list component your container renders, spread with the factory's props, as a direct child of your box                                                                                                    |
| `registerChromeLeaf`                            | Register a container's title or summary line as a kind of its own, with a sensible default keymap                                                                                                                  |
| `chromeChild`                                   | Build the reserved child-0 node for that line: the title text plus its newline (an empty title keeps the bare newline)                                                                                             |
| `isCollapsedContainer`                          | Read a container's collapse state through its descriptor, so your component and the editor's own walks agree                                                                                                       |
| `ContainerBlock`, `ContainerBlockComponent`     | What the factory returns (the child-list props, the `containerApi` you publish, the keydown handler, plus the commit, focus-exit, mode, theme and options entries), and the shape that `containerApi` must satisfy |
| `ContainerBlockDeps`, `ContainerBlockListProps` | The factory's inputs, live getters rather than captured values, and the props `BlockList` takes                                                                                                                    |
| `RefSlots`                                      | The per-child reference accessors the child-list props carry                                                                                                                                                       |
| `ChromeLeafOptions`                             | `registerChromeLeaf`'s options: a CSS class for styling the line, keymap overrides, the merge role                                                                                                                 |

### Editable-leaf authoring

_(pre-freeze / unstable)_ The container factory's sibling for leaves; the full story is [The editable leaf](plugin-guide.md#the-editable-leaf).

| Export                                                | Role                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createEditableLeaf`                                  | Wire a text-editing leaf with the editor's own caret, IME, undo, selection and clipboard; one spread wires the whole surface                           |
| `EditableLeaf`                                        | What the factory returns: the spreads, the focus surface your component re-exports, the mode and option reads                                          |
| `EditableLeafMode`                                    | The two modes: `'plain'` (always-editable source, per-keystroke commits) and `'render-primary'` (rendered view, reveal to edit, one commit on leaving) |
| `EditableLeafSurfaceProps`, `EditableLeafRenderProps` | The two spreads: the source surface's, and the folded rendered view's (a render-primary block spreads both)                                            |
| `EditableLeafDeps`                                    | The factory's inputs: live getters for the node, the index, the path, and your source element, plus the static `mode` and `singleLine` settings        |
| `StickyColumnDirection`                               | Which vertical direction the caret is entering your block from, handed to `focusAtColumn` so the column carries across lines                           |

### Inline authoring

_(pre-freeze / unstable)_ Syntax inside a paragraph: recognize it at a trigger character, render it as an **atomic widget** (one indivisible rendered thing the caret can sit beside but not inside), give it an editing policy. A **rung** is one level in the ordered ladder of recognizers a trigger consults. The render paths and the tier's limits: [Inline kinds](plugin-guide.md#inline-kinds).

| Export                                                    | Role                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `declarePluginInlineKind`                                 | Mint an inline kind, the one-level-down twin of `declarePluginKind`                                                                                                                                                                                                                        |
| `declaredPluginInlineKind`                                | Recover a declared inline kind in another module                                                                                                                                                                                                                                           |
| `isInlineKindDeclared`                                    | The is-it-there check for an inline kind                                                                                                                                                                                                                                                   |
| `registerInlineSyntax`                                    | Hook the inline scanner on one trigger character with your recognizer; a reserved trigger (one a built-in owns, like `[`) takes a prefix rung                                                                                                                                              |
| `INLINE_PRIORITIES`                                       | The inline ladder, lower consulted first: `prefixOverride` outranks a reserved trigger's built-in case, `plugin` is the bare-trigger default                                                                                                                                               |
| `InlineSyntaxRecognizer`                                  | The recognizer contract: inspect the raw at the trigger, claim a span by returning a node, or decline with null                                                                                                                                                                            |
| `InlineSyntaxOptions`                                     | The options bag: the multi-character `prefix`, the `priority`, and `rewriteImage`                                                                                                                                                                                                          |
| `ImageSyntaxRewriter`, `ImageFields`                      | The `rewriteImage` contract, for a rung whose recognizer builds built-in image nodes and must write edits back in its own syntax, and the edited fields it receives                                                                                                                        |
| `registerInlineWidgetKind`                                | Render an inline kind as a live atomic widget: a Svelte `component` (recommended) or a hand-built `buildWidget`, never both                                                                                                                                                                |
| `mintWidgetShell`                                         | Mint the marked, source-stamped span a `buildWidget` returns; its attributes are what the caret's position walk reads                                                                                                                                                                      |
| `PluginInlineKind`, `InlineNode`                          | The inline kind type, and the node your recognizer builds                                                                                                                                                                                                                                  |
| `InlineWidgetDescriptor`                                  | The widget registration: the is-this-a-widget test, one render path, the editing policy                                                                                                                                                                                                    |
| `InlineWidgetComponentProps`                              | A component widget's props: frozen `{ inline, source }`, plus live getters for the mode, the theme, the document, and the content version, and `navigateTo` to jump to another block, optionally at an offset in it (aim at a leaf: a container path scrolls into view but seats no caret) |
| `InlineWidgetEditingPolicy`, `InlineWidgetEditingContext` | The policy (reveal source on caret entry, delete granularity, edge behavior, a selected-key handler, whether the widget claims the activation click), and the context that handler receives                                                                                                |
| `isWidgetActivationClick`                                 | Whether a click activates a widget: a Ctrl/Cmd chord while editing, a plain click in reading mode                                                                                                                                                                                          |

### Commands and keybindings

_(pre-freeze / unstable)_ Which tier dispatches what: [Block commands](plugin-guide.md#block-commands).

| Export                                       | Role                                                                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockCommand`                       | Mint a `(kind, name)` command and get back its id, for a keymap binding to target                                                                                                                          |
| `registerGlobalCommand`                      | Mint a process-wide command run against whichever editor dispatched it, optionally on a global chord; also returns its id                                                                                  |
| `CommandId`                                  | A built-in command's id; a vocabulary your keymaps may bind too                                                                                                                                            |
| `KeyBinding`                                 | One keymap entry: a chord (fixed-order `Mod` / `Alt` / `Shift` plus the key), a command id, an optional baked argument                                                                                     |
| `BlockCommandContext`, `BlockCommandHandler` | What a block command's handler receives (the focused node, read-only; the argument; `updateMetadata`, the way to commit a metadata change; the mounted component's own hooks), and the handler's signature |
| `PluginCommandId`, `AnyCommandId`            | A minted command's id, and the union spanning built-in and minted                                                                                                                                          |

### Paste transforms

_(pre-freeze / unstable)_ The recipe: [Paste transforms](plugin-guide.md#paste-transforms).

| Export                   | Role                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerPasteTransform` | Register a pre-parse rewrite of pasted text; transforms run at every paste site, in install order, each seeing the previous one's output, and never on load or typing |
| `PasteTransform`         | The unit: a process-unique `name`, plus `transform(text)` returning the replacement or null for "not mine"                                                            |

### Decorations

_(pre-freeze / unstable)_ View-only annotations drawn over the rendered document. They live outside the tree, so they reach neither the saved bytes nor the undo stack. You register a source per editor through `editor.decorations` (your `onEditor` context). The recipe and both authoring contracts: [Decorations](plugin-guide.md#decorations).

| Export                                                                       | Role                                                                                                                                                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DecorationRegistry`                                                         | The `editor.decorations` surface; `addSource` registers a source and returns its handle                                                                                                        |
| `DecorationSource`                                                           | A named, pure source: `provide(document, ctx)` returns the decorations to render, and is re-run after every edit                                                                               |
| `DecorationSourceHandle`                                                     | The handle back: `invalidate()` re-runs just your source, synchronously; `dispose()` removes it                                                                                                |
| `ProvideContext`                                                             | `provide`'s second argument, carrying `editEpoch`: a counter that bumps once per document change and never on `invalidate()`. Key a cached scan on it                                          |
| `Decoration`                                                                 | The union of the four decoration types a source may return                                                                                                                                     |
| `MarkDecoration`, `WidgetDecoration`, `ReplaceDecoration`, `BlockDecoration` | The four: a styled span over an inline range, a zero-width widget at an offset, a widget covering a range whose bytes stay in the document, and a whole-block treatment with an optional badge |
| `DecorationWidgetSpec`                                                       | How a decoration's widget renders: a Svelte `component`, or a hand-built `buildDom`                                                                                                            |

### Rects

_(pre-freeze / unstable)_ Where things are on screen, reached through `editor.rects` (your `onEditor` context) or the `rects` prop every block component receives.

| Export        | Role                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EditorRects` | The geometry surface: a block's box, an inline range's rects (one per visual line), the native caret, a `reveal` that mounts a block the editor had skipped (it only mounts blocks in view), a `scrollTo` that mounts then brings a block into view, and a `navigateTo` that also lands the caret there, at the block's start or at an offset you name |

### Selection geometry

_(pre-freeze / unstable)_ The selection shapes a decoration source or geometry consumer reads.

| Export                              | Role                                                                                                                                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorSelection`, `SelectionPoint` | The `selectionChange` payload, an anchor/focus pair, and one endpoint of it: a `{ path, offset }` where `cellCoordinate: true` means `offset` counts table cells rather than characters, so check the flag before reading it as one |
| `SELECTION_END`, `SelectionEnd`     | The importable "through the end of this block's measurable content" value `rangeRects` accepts as `end`, and its type                                                                                                               |

### Parse and serialize

_(pre-freeze / unstable)_ The editor's own parse and serialize entries, re-exported here so an opener or a transform never digs into the package's internals.

| Export                                    | Role                                                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`                                   | Parse a body of Markdown into a document you can lift children from                                                                                                                                |
| `ParseScope`                              | What a parse entry is told about its input: a whole document, or one block's bytes (`'fragment'`)                                                                                                  |
| `parseContainerBody`, `ContainerBodyWrap` | Parse a body that sits between your container's own fence lines, keeping the separating blank lines out of the children; the wrap says which fence lines exist, and matches your kind's `bodyWrap` |
| `serialize`                               | A whole document back to its exact source bytes                                                                                                                                                    |
| `serializeChildren`                       | Child nodes joined back into their exact source bytes                                                                                                                                              |
| `Document`                                | The parsed-document shape both parse entries return                                                                                                                                                |
| `splitLines`                              | Split source into the parsed lines every line-scoped helper here consumes                                                                                                                          |
| `ParsedLine`                              | One source line: its text, its bytes with the ending, the ending itself, its offsets                                                                                                               |
| `isBlankLine`                             | The GFM blank-line test, spaces and tabs only. Don't substitute `trim()`: it would let a pasted non-breaking space split a block                                                                   |
| `trimTrailingLineEnding`                  | Cut the one trailing line ending (LF or CRLF) off a block's bytes, giving the text you display                                                                                                     |
| `normalizeLineEndings`                    | CRLF to LF, for text arriving from outside the document (a plugin-owned input surface)                                                                                                             |

### Grammar scanners

_(pre-freeze / unstable)_ The built-in rules for three grammars a plugin commonly claims, exported so you reuse them instead of forking the spec (the spec is longer than it looks, every time, trust me).

| Export                    | Role                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matchFenceOpen`          | Recognize a CommonMark code-fence opener line, keeping the verbatim indent and info bytes a byte-exact rebuild needs                                                                                        |
| `matchFenceClose`         | Is this line the closer for a matched opener (same marker, at least its run length)?                                                                                                                        |
| `escalatedFenceLength`    | The fence run a body forces so none of its lines reads as the closer; a floor, never a shortening. A kind that rebuilds its own raw around a body owes this, and grows the closer to match                  |
| `FenceOpen`               | A matched opener: marker, run length, trimmed `info`, verbatim `indent` and `infoRaw`                                                                                                                       |
| `htmlBlockTagLineMatcher` | Build a recognizer answering `'open'`, `'close'`, or null for one tag name's HTML block line, in every spelling the spec passes through (indented, upper-cased, trailing space), not just the canonical one |
| `blockquoteExtent`        | Scan a blockquote's full extent (CommonMark lazy continuation) from a start line: its exact bytes plus the index past it (a slice bound, not a consumed count), no child decomposition                      |

### Node access and metadata

_(pre-freeze / unstable, beyond the stable metadata pair `setPluginMetadata` / `getPluginMetadata`)_ The document tree from a plugin's side of the glass: what you read arrives read-only, and what you build yourself stays writable ([Views](plugin-guide.md#views-what-you-read-what-you-own)).

| Export                                   | Role                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CstNode`                                | The writable tree-node shape you construct: what a factory builds and a `rebuildRaw` mutates                                                             |
| `NodeView`, `DocumentView`               | The read-only views every read surface hands you. Writing bytes through one is a compile error                                                           |
| `setPluginMetadata`, `getPluginMetadata` | Store and read your kind's own typed per-node data, no casting; keep the stored shape primitive-valued                                                   |
| `getContentRange`, `ContentRange`        | The content span inside a block's raw, syntax markers excluded (a heading's `#`, a setext underline)                                                     |
| `headingLevel`                           | A heading's level, ATX or setext, null for anything else: the outline read a table-of-contents plugin wants                                              |
| `computeInlineContent`                   | Inline-parse a prose leaf, uncached and safe inside a reactive read; reference-style links come back unresolved, since no link resolver reaches a plugin |
| `isProseKind`                            | Does this kind host inline content? The gate that keeps a code block's bytes out of an inline walk                                                       |

### Performance helpers

_(pre-freeze / unstable)_ Two small tools the renderer recipe and the inline recognizers lean on.

| Export               | Role                                                                                                                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBoundedMemo`  | A bounded, least-recently-used memo for per-source work. Async work stores the promise (in-flight renders shared, failures cached like successes); `cloneOnRead` covers a cached value holding a live DOM node |
| `BoundedMemoOptions` | The memo's options: the entry `cap`, the optional `cloneOnRead`                                                                                                                                                |
| `createScanIndex`    | Turn a per-block position collector into a "first candidate at or after this offset" lookup (-1 when none), so a recognizer's decline costs one block scan instead of one per trigger                          |
