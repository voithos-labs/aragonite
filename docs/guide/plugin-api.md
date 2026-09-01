# Plugin API Reference

The catalog for the `@voithos-labs/aragonite/plugin` subpath. The recipes and the tiers themselves are in [`plugin-guide.md`](plugin-guide.md).

## API reference

Every `@voithos-labs/aragonite/plugin` export, grouped by job, so you can find a name without grepping the barrel. Values are the calls you make; the accompanying types describe their inputs and outputs.

**Plugin unit** _(pre-freeze / unstable)_

| Export               | Role                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `definePlugin`       | Validate a `{ name, setup }` unit at definition time and return it for the `plugins` prop                                                  |
| `definePluginBlock`  | The single-block plugin unit: one kind, one component, one register step — the common case                                                 |
| `isPluginInstalled`  | Idempotence probe for a named plugin's install                                                                                             |
| `EditorPlugin`       | The plugin unit's shape — `<Editor plugins>` and the main barrel's `installPlugins` take these                                             |
| `EditorPluginEntry`  | A `plugins` prop entry: a bare unit, or `{ plugin, options }` for per-instance options                                                     |
| `PluginSetupContext` | The `setup(ctx)` argument; its `onEditor(cb)` registers a per-instance callback (synchronous-only)                                         |
| `OnEditorCallback`   | An `onEditor` callback: receives the instance's `EditorContext`, may return a disposer run at unmount                                      |
| `EditorContext`      | The per-instance view a callback receives — `editorId`, live `document`, subscribe-only `events`, typed `options`, live `presentationMode` |
| `PresentationMode`   | The mode union every mode read reports — see [Presentation modes](plugin-guide.md#presentation-modes)                                      |

**Kind declaration**

| Export                            | Role                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `declarePluginKind`               | Mint a block kind from a name; rejects collisions with built-ins and prior kinds |
| `declaredPluginKind`              | Recover an already-declared kind's brand in another module without a cast        |
| `PluginBlockKind`, `AnyBlockKind` | The branded kind type, and the union of built-in and plugin kinds a node carries |

**Block-kind descriptor**

| Export                                                                                                                                           | Role                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockKind`                                                                                                                              | Register a kind's descriptor — merge behavior, editability, container shape                                                                               |
| `augmentBlockKind`                                                                                                                               | Merge extra fields into an already-registered descriptor                                                                                                  |
| `BlockKindRegistration`, `BlockKindDescriptor`, `BlockKindAugmentation`, `ContainerDescriptorGroup`, `ChildRawChange`, `MergeRole`, `UnwrapRole` | The descriptor's write shape, read shape, augmentation patch, its container-only group, `rebuildRaw`'s changed-child hint, and the closed role enums      |
| `ClosureBlock`, `ClosureColumn`, `ClosureCell`                                                                                                   | The required closure matrix per kind — one `implemented`/`inherit-default`/`not-supported` cell per cross-cutting system                                  |
| `simpleLeafClosure`, `SimpleLeafClosureCells`                                                                                                    | Preset for a simple leaf: bakes the five structurally-fixed columns, requires the four the component determines                                           |
| `containerClosure`, `ContainerClosureCells`                                                                                                      | Preset for a strip container: bakes the four structural columns and `roundTrip: implemented`, requires `roundTripVia` + the four the container determines |

**Component registry**

| Export                                                                                  | Role                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockComponent`                                                                | Bind a kind to the component that renders it                                                                                                                                              |
| `defineBlockComponent`                                                                  | Wrap a Svelte component into the registry's entry shape                                                                                                                                   |
| `BlockComponentEntry`, `BlockComponent`, `BlockComponentExports`, `BlockComponentProps` | The registry entry, the component contract, the two shapes a component may publish it as (its own members, or a container's `containerApi`), and the props every block component receives |

**Parser opener**. Placement rules are in [Opener priority](plugin-guide.md#opener-priority).

| Export                                   | Role                                                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockOpener`                    | Teach the parser to recognize a block's own Markdown syntax                                                                                                                                                   |
| `BlockOpener`, `OpenContext`             | The opener contract, and the line cursor it inspects to open a block                                                                                                                                          |
| `BlockOpenerResult`                      | What a claiming `tryOpen` returns: the node, plus the count of lines it consumed                                                                                                                              |
| `OPENER_PRIORITIES`                      | The built-in priority ladder your opener prices against _(pre-freeze / unstable)_                                                                                                                             |
| `lineStartsOuterBlock`, `OuterBlockScan` | Does a line start a block at the outer level? The shared end-of-extent test for a container opener scanning its own lines, and the flag saying whether a paragraph is open above it _(pre-freeze / unstable)_ |

**Enter completion** _(pre-freeze / unstable)_. The recipe is in [Typing a multi-line construct into existence](plugin-guide.md#typing-a-multi-line-construct-into-existence).

| Export                   | Role                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `registerBlockCompleter` | Let one typed line complete into a grammar whose lines must be adjacent                        |
| `BlockCompleter`         | The completer contract: `tryComplete(line)` claims or declines                                 |
| `CompletionResult`       | A claim: the lines to mint (no endings) plus the caret's path, line and column inside the mint |

**Directive authoring** _(pre-freeze / unstable)_. Full semantics are in the [directives guide](directives.md).

| Export                                                                                             | Role                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `activateDirectives`                                                                               | Turn the `:::name` grammar on; call once at startup, before the first parse                                            |
| `registerDirective`                                                                                | Map a `(tier, name)` to one of your kinds                                                                              |
| `isDirectiveRegistered`                                                                            | Idempotence probe for a directive registration                                                                         |
| `parseDirectiveAttributes`                                                                         | Opt-in reader pulling `[label]{attrs}` out of a directive's info string                                                |
| `serializeDirective`                                                                               | Serialize a fence back to bytes losslessly from a registered kind                                                      |
| `escalatedColonCount`                                                                              | The fence length a body needs, for an emitter building `:::name` text by hand rather than through `serializeDirective` |
| `createDirectiveRebuild`                                                                           | Build the `rebuildRaw` for a title-child-0 directive container — owns the CRLF-safe fence bytes                        |
| `DIRECTIVE_BODY_WRAP`                                                                              | The wrap every `:::` body parses with; declare it as your container kind's `bodyWrap`                                  |
| `DirectiveDefinition`, `ParsedDirective`, `DirectiveTier`, `DirectiveFence`, `DirectiveAttributes` | The registration definition, the parsed fence handed to your factory, and the supporting shapes                        |

**Inline authoring** _(pre-freeze / unstable)_. The two render paths and the tier's limits are in [Inline kinds](plugin-guide.md#inline-kinds).

| Export                                                                                                                                                                        | Role                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `declarePluginInlineKind`                                                                                                                                                     | Mint an inline kind                                                                                                            |
| `declaredPluginInlineKind`                                                                                                                                                    | Recover a declared inline kind's brand in another module                                                                       |
| `isInlineKindDeclared`                                                                                                                                                        | Idempotence probe for an inline-kind declaration                                                                               |
| `registerInlineSyntax`                                                                                                                                                        | Hook the scanner on a trigger character with your recognizer (a bare trigger, or a reserved trigger via a prefix rung)         |
| `INLINE_PRIORITIES`                                                                                                                                                           | The inline priority ladder a prefix rung prices against — `prefixOverride` outranks a reserved trigger's built-in case         |
| `InlineSyntaxOptions`                                                                                                                                                         | The `{ prefix, priority, rewriteImage }` options bag for a rung                                                                |
| `registerInlineWidgetKind`                                                                                                                                                    | Register an inline kind as a live atomic widget — a `component` (recommended) or a hand-built `buildWidget`                    |
| `mintWidgetShell`                                                                                                                                                             | Mint the marked, source-stamped island span a `buildWidget` returns — the shell the offset walk reads                          |
| `PluginInlineKind`, `InlineNode`, `InlineSyntaxRecognizer`, `InlineWidgetDescriptor`, `InlineWidgetComponentProps`, `InlineWidgetEditingPolicy`, `InlineWidgetEditingContext` | The inline kind and node types, the recognizer contract, and the widget descriptor plus its component-props and editing shapes |
| `ImageSyntaxRewriter`, `ImageFields`                                                                                                                                          | The `rewriteImage` contract, and the image fields an edit hands it                                                             |

**Commands and keybindings** _(pre-freeze / unstable)_. Dispatch tiers are in [Block commands](plugin-guide.md#block-commands).

| Export                                                                                                     | Role                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registerBlockCommand`                                                                                     | Mint a `(kind, name)` block command and get back its id                                                                                             |
| `registerGlobalCommand`                                                                                    | Mint a process-wide command run against the dispatching editor's `EditorContext`, optionally bound to a global chord                                |
| `CommandId`, `KeyBinding`, `BlockCommandContext`, `BlockCommandHandler`, `PluginCommandId`, `AnyCommandId` | A built-in command id, a per-kind chord binding, the context and signature of a command handler, a minted command's id, and the union spanning both |

**Container authoring and chrome** _(pre-freeze / unstable)_

| Export                                                                                                                        | Role                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createContainerBlock`                                                                                                        | Wire a nested-`BlockList` container so your block is as thin as the blockquote                                                                                            |
| `BlockList`                                                                                                                   | The child-list component your container renders with the factory's props                                                                                                  |
| `registerChromeLeaf`                                                                                                          | Register a container's title/summary leaf with a default keymap                                                                                                           |
| `chromeChild`                                                                                                                 | Mint the reserved child-0 node for that leaf — the title/summary text plus its trailing newline                                                                           |
| `isCollapsedContainer`                                                                                                        | Read a container's collapse state, so a component and the model layer agree                                                                                               |
| `ContainerBlock`, `ContainerBlockComponent`, `ContainerBlockDeps`, `ContainerBlockListProps`, `RefSlots`, `ChromeLeafOptions` | The container API, the component surface it returns, the deps it takes, the child-list props, the child-ref slot accessors those props carry, and the chrome-leaf options |

**Editable-leaf authoring** _(pre-freeze / unstable)_

| Export                                                                                                        | Role                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `createEditableLeaf`                                                                                          | Wire a text-editing leaf surface — plain or render-primary — with native caret/IME/undo/cross-block-selection parity            |
| `EditableLeaf`, `EditableLeafSurfaceProps`, `EditableLeafRenderProps`, `EditableLeafDeps`, `EditableLeafMode` | The leaf API your component re-exports, its two one-spread surfaces (source and folded view), its thunk deps, and the two modes |
| `StickyColumnDirection`                                                                                       | The vertical-entry direction `focusAtColumn` receives when the caret traverses into your block                                  |

**Parse / serialize helpers** _(pre-freeze / unstable)_

| Export                                    | Role                                                                                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`                                   | Parse a body of Markdown into a document you can lift children from                                                                                                               |
| `ParseScope`                              | The scope both parse entries take: whole document, or one block's bytes                                                                                                           |
| `parseContainerBody`, `ContainerBodyWrap` | Parse a container body that sits between chrome lines of your own, keeping their blank separators out of the children — declare the same wrap as your kind's `container.bodyWrap` |
| `serialize`                               | Serialize a whole document back to its exact source bytes                                                                                                                         |
| `serializeChildren`                       | Join child nodes back into their exact source bytes                                                                                                                               |
| `trimTrailingLineEnding`                  | Read a child's display text without dropping a trailing line ending                                                                                                               |
| `normalizeLineEndings`                    | Normalize external text (a plugin-owned input surface) to LF                                                                                                                      |
| `isBlankLine`                             | GFM §2.1's blank-line test — spaces and tabs only, never `trim()`                                                                                                                 |
| `splitLines`                              | Split source into the parsed lines every line-scoped seam consumes                                                                                                                |
| `Document`, `ParsedLine`                  | The parsed-document shape, and a single parsed source line                                                                                                                        |

**Renderer utilities** _(pre-freeze / unstable)_

| Export               | Role                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createBoundedMemo`  | A bounded LRU memo for per-source work — a renderer's render, a recognizer's scan index — sync (with an optional `cloneOnRead`) or async (the render promise is the cached value) |
| `BoundedMemoOptions` | The memo's options — the entry `cap` and the optional `cloneOnRead`                                                                                                               |

**Recognizer scan index** _(pre-freeze / unstable)_

| Export            | Role                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createScanIndex` | Turn a per-block position collector into a memoized "first candidate at or after this offset" lookup (-1 when none), so a decline costs one block scan instead of one per trigger |

**Fence grammar** _(pre-freeze / unstable)_

| Export                 | Role                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `matchFenceOpen`       | Recognize a CommonMark fence-opener line, verbatim indent/info bytes included                                                                                                                   |
| `matchFenceClose`      | Test a line as the closer for a matched opener (marker + minimum run length)                                                                                                                    |
| `escalatedFenceLength` | The fence run a body needs so no line inside it reads as the closer — a floor, never a shorter fence. A kind that rebuilds its own raw around a body owes it, and must grow the CLOSER to match |
| `FenceOpen`            | The matched opener's shape: marker, run length, trimmed `info`, verbatim `indent` + `infoRaw`                                                                                                   |

**HTML tag-line grammar** _(pre-freeze / unstable)_

| Export                    | Role                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `htmlBlockTagLineMatcher` | Build a recognizer for one tag name's CommonMark type-6 line, open or close — every spelling the spec hands to raw-HTML passthrough, not just the canonical one |

**Blockquote grammar** _(pre-freeze / unstable)_

| Export             | Role                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blockquoteExtent` | Scan a blockquote's extent (CommonMark §5.1 lazy continuation) from a start line, returning its `raw` plus the `nextIndex` past it (a slice bound, not an opener's `consumed` delta) — no child decomposition |

**CST node access and metadata** _(pre-freeze / unstable beyond the stable metadata pair)_

| Export                                   | Role                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setPluginMetadata`, `getPluginMetadata` | Store and read your kind's own typed per-node metadata without casting                                                                                 |
| `getContentRange`, `ContentRange`        | The content span within a block's raw, syntax markers excluded (heading `#`, setext underline)                                                         |
| `headingLevel`                           | A heading's level (ATX or setext), null otherwise — the outline reader for a table-of-contents plugin                                                  |
| `computeInlineContent`, `isProseKind`    | Inline-parse a prose leaf (uncached, reactive-safe) and gate the walk — for document-wide state derived from inline structure, e.g. footnote numbering |
| `CstNode`                                | The tree-node shape your factory builds and your `rebuildRaw` mutates                                                                                  |
| `NodeView`, `DocumentView`               | The bytes-readonly views every read surface hands you ([Views](plugin-guide.md#views-what-you-read-what-you-own))                                      |

**Idempotence probes**

| Export                                                                                                         | Role                                                         |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `isBlockKindDeclared`                                                                                          | Probe a kind declaration, where both declaration seams throw |
| `isBlockKindRegistered`, `isBlockComponentRegistered`, `isBlockOpenerRegistered`, `isBlockCompleterRegistered` | Guard each register-once call so re-import is safe           |
| `isPasteTransformRegistered`                                                                                   | The same guard for a paste transform's name                  |

**Paste transforms** _(pre-freeze / unstable)_. The recipe is in [Paste transforms](plugin-guide.md#paste-transforms).

| Export                   | Role                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `registerPasteTransform` | Register a content-keyed pre-parse clipboard rewrite (paste-scoped, install-order) |
| `PasteTransform`         | The transform's shape — a unique name and a `transform(text) → string \| null`     |

**Decorations** _(pre-freeze / unstable)_. The recipe and the two authoring contracts are in [Decorations](plugin-guide.md#decorations).

View-only annotations layered over the rendered document, never part of the CST. Register a pure per-instance source through `editor.decorations` (your `onEditor` context).

| Export                                                                       | Role                                                                                                        |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DecorationRegistry`                                                         | The `editor.decorations` surface — `addSource` registers a source and returns a handle                      |
| `DecorationSource`                                                           | A named, pure source: `provide(document, ctx)` returns the decorations to render                            |
| `DecorationSourceHandle`                                                     | The registration handle — `invalidate()` re-runs one source, `dispose()` removes it                         |
| `ProvideContext`                                                             | The second `provide` argument — carries the monotonic `editEpoch` a cached source keys its rescan on        |
| `Decoration`                                                                 | The union of the four decoration kinds a source may return                                                  |
| `MarkDecoration`, `WidgetDecoration`, `ReplaceDecoration`, `BlockDecoration` | The four kinds — an inline mark span, a positioned widget, a range replacement, and a whole-block treatment |
| `DecorationWidgetSpec`                                                       | A widget's render spec — a Svelte `component` or a hand-built `buildDom`                                    |

**Rects** _(pre-freeze / unstable)_

Viewport-space geometry over the rendered document, reached through `editor.rects` (your `onEditor` context).

| Export        | Role                                                                                                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorRects` | The `editor.rects` surface — a block's box, an inline range's rects, the native caret, a reveal that mounts a windowed-out block, a scrollTo that mounts then scrolls the viewport to a block, and a navigateTo that also lands the caret there |

**Selection geometry** _(pre-freeze / unstable)_

The selection shapes a decoration source or rect consumer reads.

| Export                              | Role                                                                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorSelection`, `SelectionPoint` | The `selectionChange` payload — an anchor/focus pair — and its endpoint: a `{ path, offset }` union discriminated by `cellCoordinate` (`true` ⇒ `offset` is a table cell index; narrow on the flag before reading it as a char offset) |
| `SELECTION_END`, `SelectionEnd`     | The importable sentinel `rangeRects` accepts as `end` ("through the block's last measurable position")                                                                                                                                 |
