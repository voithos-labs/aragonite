/**
 * Every source file and directory the lint scans read or walk, keyed by what it is for, so moving
 * one is one edit here. `source-paths.test.ts` fails on an entry that names nothing on disk.
 * Paths run from the repo root; a directory ends in `/` so it doubles as a path prefix.
 */

/** The single source files the scans read, bind or pin. */
export const SOURCE = {
	// ── Published entry points and root modules ─────────────────────────────
	publicBarrel: 'src/lib/index.ts',
	pluginBarrel: 'src/lib/plugin.ts',
	testingBarrel: 'src/lib/testing.ts',
	editorProps: 'src/lib/editor-props.ts',
	blockComponentApi: 'src/lib/block-component.ts',
	actionContracts: 'src/lib/action-contracts.ts',
	envFlags: 'src/lib/env.ts',

	// ── Parsing and the inline pipeline ─────────────────────────────────────
	cstNodes: 'src/lib/core/nodes.ts',
	parser: 'src/lib/core/parser.ts',
	lineSplitter: 'src/lib/core/lines.ts',
	inlineRender: 'src/lib/core/inline-render.ts',
	directiveGrammar: 'src/lib/core/directive/grammar.ts',
	inlineScanLoop: 'src/lib/core/inline/scan/index.ts',
	autolinkGrammar: 'src/lib/core/inline/scan/autolinks.ts',
	htmlTagGrammar: 'src/lib/core/inline/html-tag-grammar.ts',
	linkReferenceResolver: 'src/lib/core/inline/link-reference-resolver.ts',
	inlineCache: 'src/lib/core/inline/inline-cache.ts',
	inlineWidgets: 'src/lib/core/inline/inline-widgets.ts',
	inlineVisibility: 'src/lib/core/inline/visibility.ts',
	inlineWalk: 'src/lib/core/inline/walk.ts',
	formatToggle: 'src/lib/core/inline/format-toggle.ts',
	imageSourceBytes: 'src/lib/core/inline/image-source-bytes.ts',
	linkSourceBytes: 'src/lib/core/inline/link-source-bytes.ts',

	// ── Block-kind registries, commands and raw rules ───────────────────────
	blockOpeners: 'src/lib/schema/block-openers.ts',
	registryView: 'src/lib/schema/registry-view.ts',
	pluginActivation: 'src/lib/schema/plugin-activation.ts',
	inlineConstructPolicy: 'src/lib/schema/inline-construct-policy.ts',
	commands: 'src/lib/schema/commands.ts',
	keybindings: 'src/lib/schema/keybindings.ts',
	fenceRule: 'src/lib/schema/fenced-code-raw.ts',
	tableCellEscape: 'src/lib/schema/table-cell-raw.ts',

	// ── Tree operations ─────────────────────────────────────────────────────
	treeOperationsBarrel: 'src/lib/tree-operations/index.ts',
	nodePrimitives: 'src/lib/tree-operations/node-primitives.ts',
	unshare: 'src/lib/tree-operations/unshare.ts',
	settle: 'src/lib/tree-operations/settle.ts',
	contentWrite: 'src/lib/tree-operations/content-write.ts',
	nodeOps: 'src/lib/tree-operations/node-ops.ts',
	chainRebuild: 'src/lib/tree-operations/chain-rebuild.ts',
	blockquoteOps: 'src/lib/tree-operations/blockquote.ts',
	listItemMoves: 'src/lib/tree-operations/list/item-moves.ts',

	// ── Editor actions and the commit ───────────────────────────────────────
	commitEngine: 'src/lib/editor-actions/commit/undo-controller.ts',
	commitScope: 'src/lib/invariants/commit-scope.ts',
	blockEditCore: 'src/lib/editor-actions/block-edit-core.ts',
	leafWrite: 'src/lib/editor-actions/leaf-write.ts',
	containerBlockComponent: 'src/lib/editor-actions/container-block-component.ts',
	pluginContainer: 'src/lib/editor-actions/plugin/container.ts',

	// ── Selection and keys ──────────────────────────────────────────────────
	docPathBrand: 'src/lib/selection/path-math.ts',
	sharedKeydown: 'src/lib/selection/shared-keydown.ts',
	nativeBridge: 'src/lib/selection/native-bridge.ts',
	rangeDelete: 'src/lib/selection/range-delete.ts',
	crossBlockKeydown: 'src/lib/selection/cross-block/keydown.ts',
	pointerPreamble: 'src/lib/selection/cross-block/pointer.ts',
	rangeReplace: 'src/lib/selection/cross-block/range-replace.ts',

	// ── Caret geometry and windowing ────────────────────────────────────────
	coordinateBrands: 'src/lib/cursor/coordinate-spaces.ts',
	domWalk: 'src/lib/cursor/dom-walk.ts',
	scrollOwner: 'src/lib/cursor/scroll-owner.ts',
	scrollport: 'src/lib/cursor/scrollport.ts',
	holdAcross: 'src/lib/reactivity/hold-across.ts',
	layoutState: 'src/lib/reactivity/layout-state.svelte.ts',
	listWindowing: 'src/lib/reactivity/list-windowing.svelte.ts',

	// ── Components ──────────────────────────────────────────────────────────
	editorShell: 'src/lib/components/Editor.svelte',
	editorRootKeydown: 'src/lib/components/editor-root-keydown.ts',
	blockList: 'src/lib/components/BlockList.svelte',
	blockHost: 'src/lib/components/BlockHost.svelte',
	searchBar: 'src/lib/components/SearchBar.svelte',
	selectionOverlay: 'src/lib/components/SelectionOverlay.svelte',
	editableLeaf: 'src/lib/components/blocks/editable-leaf.ts',
	surfaceWrite: 'src/lib/components/blocks/surface-write.ts',
	textBlock: 'src/lib/components/blocks/text/TextEditableBlock.svelte',
	textRender: 'src/lib/components/blocks/text/text-render.ts',
	textClipboard: 'src/lib/components/blocks/text/text-clipboard.ts',
	edgePolicyDispatch: 'src/lib/components/blocks/text/edge-policy-dispatch.ts',
	liveSelectionEdit: 'src/lib/components/blocks/text/live-selection-edit.ts',
	delimiterAutopair: 'src/lib/components/blocks/text/delimiter-autopair.ts',
	codeBlock: 'src/lib/components/blocks/code/CodeBlock.svelte',
	listBlock: 'src/lib/components/blocks/list/ListBlock.svelte',
	tableBlock: 'src/lib/components/blocks/table/TableBlock.svelte',
	tableCell: 'src/lib/components/blocks/table/TableCellBlock.svelte',
	cellRender: 'src/lib/components/blocks/table/cell-render.ts',
	imageProperties: 'src/lib/components/image/ImageProperties.svelte',
	imageWidgetEditing: 'src/lib/components/image/image-widget-editing.ts',
	linkCard: 'src/lib/components/link-card/LinkCard.svelte',
	linkCardHost: 'src/lib/components/link-card/LinkCardHost.svelte',

	// ── Bundled plugins and styles ──────────────────────────────────────────
	latexBlockMath: 'src/lib/plugins/latex/BlockMath.svelte',
	mathShape: 'src/lib/plugins/latex/math-shape.ts',
	mermaidBlock: 'src/lib/plugins/mermaid/MermaidBlock.svelte',
	editorCss: 'src/lib/styles/editor.css',
	themeTokens: 'src/lib/styles/editor-theme.css',

	// ── Tests ───────────────────────────────────────────────────────────────
	scanSource: 'src/lib/test/invariants/lint/scan-source.ts',
	unitSettle: 'src/lib/test/harness/settle.ts',
	unitPluginPlatform: 'src/lib/test/support/plugin-platform.ts',
	scanTestHelpers: 'src/lib/test/core/inline/scan/scan-test-helpers.ts',
	revealLeafFixture: 'src/lib/test/blocks/fixtures/RevealLeafBlock.svelte',
	compositionDriverLint: 'src/lib/e2e/lint/composition-driver.test.ts',

	// ── Demo routes and the consumer example ────────────────────────────────
	appCss: 'src/app.css',
	showcaseRoute: 'src/routes/+page.svelte',
	calloutReferenceKind: 'src/routes/test/plugins/callout/callout-kind.ts',
	memoReferenceBlock: 'src/routes/test/plugins/memo/MemoBlock.svelte',
	consumerPluginProbe: 'examples/consumer/src/plugin-probe.ts'
} as const;

/** The directories the scans walk or bind by prefix. */
export const SOURCE_DIR = {
	sourceTree: 'src/',
	library: 'src/lib/',
	blockParsers: 'src/lib/core/parsers/',
	directive: 'src/lib/core/directive/',
	inline: 'src/lib/core/inline/',
	liveEdit: 'src/lib/core/inline/live-edit/',
	schema: 'src/lib/schema/',
	treeOperations: 'src/lib/tree-operations/',
	editorActions: 'src/lib/editor-actions/',
	commit: 'src/lib/editor-actions/commit/',
	selection: 'src/lib/selection/',
	crossBlock: 'src/lib/selection/cross-block/',
	cursor: 'src/lib/cursor/',
	ambient: 'src/lib/ambient/',
	decorations: 'src/lib/decorations/',
	search: 'src/lib/search/',
	inlineMenu: 'src/lib/inline-menu/',
	components: 'src/lib/components/',
	blocks: 'src/lib/components/blocks/',
	textBlock: 'src/lib/components/blocks/text/',
	codeBlock: 'src/lib/components/blocks/code/',
	plugins: 'src/lib/plugins/',
	latexPlugin: 'src/lib/plugins/latex/',
	testing: 'src/lib/testing/',
	unitTests: 'src/lib/test/',
	unitPerfTests: 'src/lib/test/perf/',
	unitLint: 'src/lib/test/invariants/lint/',
	invariantTests: 'src/lib/test/invariants/',
	testHarness: 'src/lib/test/harness/',
	testSupport: 'src/lib/test/support/',
	pluginTests: 'src/lib/test/plugins/',
	e2e: 'src/lib/e2e/',
	e2eTests: 'src/lib/e2e/tests/',
	e2ePerfTests: 'src/lib/e2e/tests/perf/',
	e2eLint: 'src/lib/e2e/lint/',
	e2eRequirements: 'src/lib/e2e/requirements/',
	routes: 'src/routes/',
	referencePlugins: 'src/routes/test/plugins/',
	consumerExample: 'examples/consumer/src/'
} as const;
