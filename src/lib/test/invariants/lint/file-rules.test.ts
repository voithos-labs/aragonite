/**
 * File rules over the shipped source: each row names a shape a file may not hold, the files
 * allowed to hold it, and the snippets its matcher must flag or spare. The scan is `file-rule.ts`;
 * a row carries its G-number where the invariant catalog has one, and every row reads the one
 * source collection taken below.
 */

import {
	collectEditorSources,
	fileClasses,
	isProseSurface,
	LEXICAL_CLASSES,
	type SourceFile
} from './scan-source';
import {
	describeFileRules,
	except,
	notUnder,
	svelteOnly,
	under,
	type FileRule,
	type Probe
} from './file-rule';

const at = (relPath: string, code: string): Probe => ({ relPath, code });

// ── G4.15 coordinate brands ──────────────────────────────────────────────────

const COORDINATE_HOME = 'src/lib/cursor/coordinate-spaces.ts';
const DOCPATH_HOME = 'src/lib/selection/path-math.ts';
const BRANDS = ['RawOffset', 'DomTextOffset', 'EditorX', 'ViewportX', 'CellIndex', 'DocPath'];

/** Where each brand's bare `as <Brand>` cast may live. `DocPath` composes in the neutral
 *  coordinate module too, which `tree-operations` can reach without importing `selection/`. */
const BRAND_CAST_HOME: Record<string, string[]> = {
	RawOffset: [COORDINATE_HOME],
	DomTextOffset: [COORDINATE_HOME],
	EditorX: [COORDINATE_HOME],
	ViewportX: [COORDINATE_HOME],
	CellIndex: [COORDINATE_HOME],
	DocPath: [DOCPATH_HOME, COORDINATE_HOME]
};

const BRAND_CAST_RE = /\bas\s+(RawOffset|DomTextOffset|EditorX|ViewportX|CellIndex|DocPath)\b/g;
const MINT_CALL_RE = /\bas(RawOffset|DomTextOffset|EditorX|ViewportX|CellIndex|DocPath)\s*\(/;

const BENIGN_BRAND_USES =
	'import { toRawOffset, extendDocPath, docPathFrom } from "./coordinate-spaces";\n' +
	'import { type DocPath } from "./path-math";\n' +
	'const a: RawOffset = toRawOffset(b, 2);\n' +
	'const p: DocPath = extendDocPath(parent, 0);\n' +
	'const q: DocPath = docPathFrom([0, 1]);\n' +
	'const c = x as RawOffsetLike;\n' +
	'asRawOffsetFixture(3);';

// ── G4.13 view-stripping casts ───────────────────────────────────────────────

/** `as CstNode` / `as Document`, the tail of `as unknown as X` included; an indexed-access
 *  type (`as CstNode['metadata']`) is not a cast back to mutable. */
const STRIP_CAST_RE = /\bas\s+(CstNode|Document)\b(?!\s*\[\s*')/g;
const CST_DOCUMENT_IMPORT_RE = /import[^;]*\bDocument\b[^;]*from\s+'[^']*core\/nodes'/;

/** `as Document` counts only where the CST `Document` is imported; elsewhere it is the DOM one. */
function stripsView(file: SourceFile): boolean {
	const countsDocument = CST_DOCUMENT_IMPORT_RE.test(file.code);
	return [...file.code.matchAll(STRIP_CAST_RE)].some((m) => m[1] !== 'Document' || countsDocument);
}

const CST_IMPORT = "import type { CstNode, Document } from '../core/nodes';\n";

// ── G4.44 / G4.65 prose surfaces ─────────────────────────────────────────────

const LIVE_EDIT_HOME = 'src/lib/components/blocks/text/live-selection-edit.ts';
const AUTOPAIR_HOME = 'src/lib/components/blocks/text/delimiter-autopair.ts';
const RESOLVES_LIVE_EDIT = /(?<![\w.])(?:resolveLiveRangeEdit|applyLiveRangeEdit)\s*\(/;
const APPLIES_AUTOPAIR = /(?<![\w.])applyDelimiterAutoPair\s*\(/;

const PROSE_SURFACE =
	'createEditableSurface({}); getInlineConstructPolicy(k); <div onbeforeinput={f}>';
const ROGUE_SURFACE = 'src/lib/components/blocks/x/Rogue.svelte';

/** A file calling `resolver` from outside the module that defines it. */
const callsOutsideHome =
	(home: string, resolver: RegExp) =>
	(file: SourceFile): boolean =>
		file.relPath !== home && resolver.test(file.code);

/** Both directions of a surface rule: every prose surface calls the resolver, and every caller
 *  outside its home is a prose surface. */
function surfaceParity(
	id: string,
	home: string,
	resolver: RegExp,
	call: string,
	reason: string
): FileRule[] {
	const callsResolver = callsOutsideHome(home, resolver);
	return [
		{
			id,
			population: isProseSurface,
			matches: (file) => !callsResolver(file),
			reason,
			atLeast: 2,
			hits: [at(ROGUE_SURFACE, PROSE_SURFACE)],
			misses: [at(ROGUE_SURFACE, `${PROSE_SURFACE} ${call}`)]
		},
		{
			id: `${id}: the callers are exactly those surfaces`,
			population: callsResolver,
			matches: (file) => !isProseSurface(file),
			reason:
				'only a prose surface may call the resolver, which prevents the default and owns where the caret lands',
			atLeast: 2,
			hits: [at('src/lib/components/blocks/x/rogue.ts', call)],
			misses: [`// ${call} is the resolver`, `const x = my${call}`]
		}
	];
}

// ── G4.39 command surfaces ───────────────────────────────────────────────────

/** A component building a text block's editable area, which holds the built-in command bodies. */
const COMMAND_SURFACE_RE = /\bcreateEditableSurface\s*\(/;
const PUBLISHES_RUN_COMMAND_RE = /\bexport\s+(?:const|function)\s+runCommand\b/;

// ── G4.73 editable leaves ────────────────────────────────────────────────────

const LEAF_SURFACE_RE = /\bcreateEditableLeaf\s*\(/;
const PUBLISHES_SOURCE_COMMIT_RE = /\bexport\s+(?:const|function)\s+afterSourceCommit\b/;

// ── G4.47 whole-block editing host ───────────────────────────────────────────

/** The predicate that knows the host, plus the attribute a selector-level reader excludes by. */
const HOST_AWARE_RE =
	/(?<![\w'"])(isEditableEventTarget|isWholeBlockInputProxy|holdsWholeBlockFocus|WHOLE_BLOCK_INPUT_ATTR)\b/;

/** A `[contenteditable…]` selector handed to a DOM lookup, Prettier-wrapped or type-argumented. */
const SELECTOR_READ_RE =
	/\.(?:querySelector(?:All)?|closest|matches)\s*(?:<[^<>()]*>)?\s*\(\s*[`'"][^`'"]*\[contenteditable/;

/** `document.activeElement` compared by identity, which the host taking focus silently falsifies. */
const ACTIVE_IDENTITY_RE = /document\.activeElement\s*[!=]==|[!=]==\s*document\.activeElement/;

// ── G4.51 debounced checkpoints ──────────────────────────────────────────────

/** The definition sites declare the members rather than spending them as a pair. */
const CHECKPOINT_DECLARATIONS = [
	'src/lib/action-contracts.ts',
	'src/lib/editor-actions/commit/undo-controller.ts'
];

function pairing(
	id: string,
	push: RegExp,
	arm: RegExp,
	pushCall: string,
	armCall: string
): FileRule {
	return {
		id,
		population: (file) => !CHECKPOINT_DECLARATIONS.includes(file.relPath) && push.test(file.code),
		matches: (file) => !arm.test(file.code),
		reason: 'a checkpoint push must arm the matching pause once its edit settles (#71)',
		hits: [`controller.${pushCall}([0], 0);`],
		misses: [`controller.${pushCall}([0], 0); controller.${armCall}();`]
	};
}

// ── G4.71 / G4.72 Markdown whitespace ────────────────────────────────────────

/** `x.trim() === ''`, `x.trim().length === 0` and `!x.trim()`: an emptiness test by `trim()`. */
const EMPTY_BY_TRIM =
	/\.trim\(\)\s*(?:[!=]==\s*''|\.length\s*(?:[!=]==|[<>]=?)\s*[01]\b)|!\s*[\w$.?[\]()]+\.trim\(\)\s*(?:[)&|;?]|$)/m;

/** The grammar files outside `core/parsers/` whose whitespace is GFM's: the one class home, the
 *  bare autolink boundary, the tag grammar and label matching. */
const GRAMMAR_FILES = [
	'src/lib/core/lines.ts',
	'src/lib/core/inline/scan/autolinks.ts',
	'src/lib/core/inline/html-tag-grammar.ts',
	'src/lib/core/inline/link-reference-resolver.ts'
];

const PARSER_PROBE = 'src/lib/core/parsers/probe.ts';

/** Plugin grammars share the parser's whitespace: the directive grammar and the bundled plugins. */
const PLUGIN_GRAMMAR_DIRS = ['src/lib/core/directive/', 'src/lib/plugins/'];

const SHOWS_INK = 'whether the render shows ink, not whether the Markdown is blank';

// ── The decorations directory ────────────────────────────────────────────────

const DECORATIONS_DIR = 'src/lib/decorations/';

const DOM_MEASURES = [
	/\b(?:textContent|innerText)\b[^;\n]{0,40}\.length\b/,
	/\b\w*[Dd]omTextLength\b/,
	/\brawTextOfNode\s*\([^)]*\)\s*\.length\b/
];

// ── Editor-owned values ──────────────────────────────────────────────────────

/** The getters the editor hands down for values it owns, by the names readers destructure them as. */
const EDITOR_GETTERS = [
	'getTheme',
	'theme',
	'getPresentationMode',
	'presentationMode',
	'blockDragHandles',
	'getDragHandles',
	'getDocument',
	'getContentVersion',
	'navigateTo',
	'computeInlineContent'
];

// ── G4.78 the grid contract ──────────────────────────────────────────────────

const CODE = LEXICAL_CLASSES.indexOf('code');
const QUOTED_GRID = /(['"`])grid\1/g;
const DECLARED_BEFORE = /\b(?:contract|containerContract)\??\s*:\s*$/;
const UNION_BEFORE = /(?<!\|)\|\s*$/;
const UNION_AFTER = /^\s*\|(?!\|)/;

/** Whether a whole `'grid'` literal in code reads the contract: every one does but a declaration
 *  (`contract: 'grid'`) and a member of the contract's union type, which only name it. */
function readsGridLiteral(file: SourceFile): boolean {
	const classes = fileClasses(file);
	for (const { index, 0: literal } of file.code.matchAll(QUOTED_GRID)) {
		const end = index + literal.length;
		const whole = classes[index] !== CODE && (index === 0 || classes[index - 1] === CODE);
		if (!whole || (end < file.code.length && classes[end] !== CODE)) continue;
		const before = file.code.slice(Math.max(0, index - 64), index);
		const after = file.code.slice(end, end + 64);
		if (DECLARED_BEFORE.test(before)) continue;
		if (UNION_BEFORE.test(before) || UNION_AFTER.test(after)) continue;
		return true;
	}
	return false;
}

// ── The rules ────────────────────────────────────────────────────────────────

const RULES: FileRule[] = [
	{
		id: 'G4.4 no timing hacks for sequencing',
		matches: /\b(?:setTimeout|setInterval|queueMicrotask|requestAnimationFrame)\s*\(/,
		allowed: {
			'src/lib/selection/autoscroll.ts': 'rAF autoscroll loop: an animation cadence, not ordering',
			'src/lib/components/blocks/editable-leaf.ts':
				'rAF fold of a revealed source after a range drag: the blur it answers arrives inside the frame that measured the range',
			'src/lib/cursor/observe-resize.ts':
				'rAF start of a size observation: one begun while a frame delivers resize notifications is skipped and reported as a loop error',
			'src/lib/components/drag-handle.ts':
				'rAF placement of the drag handle once its block has laid out; the handle is its own hit target before any hover',
			'src/lib/selection/pointer-session.ts':
				'rAF pointermove coalescing: the one place every drag lifecycle runs',
			'src/lib/editor-actions/commit/text-batch.ts':
				'setTimeout wall-clock undo debounce, a pause detection tick() cannot express',
			'src/lib/search/regex-executor.ts':
				'setTimeout regex-scan cancellation deadline: nothing waits on the timer, and no main-thread budget can interrupt one RegExp.exec'
		},
		reason:
			'`await tick()` is the only sequencing primitive; a timing primitive that is a cadence or a wall-clock deadline joins the allowlist with why',
		hits: [
			'setTimeout(() => x, 0)',
			'setInterval(() => x, 0)',
			'queueMicrotask(() => x, 0)',
			'requestAnimationFrame(() => x, 0)'
		],
		misses: [
			'clearTimeout(id);\ncancelAnimationFrame(raf);\nlet t: ReturnType<typeof setTimeout> | null = null;'
		]
	},
	{
		id: 'G4.31 the pending marks are spent only where typed or composed text is written',
		matches: /\bpendingMarks\.consume\b/,
		allowed: {
			'src/lib/components/blocks/text/edge-policy-dispatch.ts':
				'the typed byte at a collapsed live caret, written with the marks around it',
			'src/lib/components/blocks/text/TextEditableBlock.svelte':
				'hands the spend to the composition write, which writes the composed text',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'hands the spend to the cell’s composition write, which writes the composed text'
		},
		reason:
			'a set spent where no text is written is a promise dropped with nothing written: route the spend through the typing or composition write',
		reaches: ['src/lib/components/blocks/text/edge-policy-dispatch.ts'],
		hits: [
			'const marks = deps.pendingMarks.consume();',
			'consumePendingMarks: caretMemory.pendingMarks.consume,'
		],
		misses: [
			'caretMemory.pendingMarks.toggle(format);',
			'restore: caretMemory.pendingMarks.restore'
		]
	},
	{
		id: 'every dev-only check reads the build flag through env.ts',
		matches: /from\s*['"]esm-env['"]/,
		allowed: {
			'src/lib/env.ts': 'the one reader: isDevChecks() answers for every dev-only check'
		},
		reason:
			'a check reading DEV itself stays off under configureEditorEnv({ isDev: true }), so a suite on a toolchain resolving no export conditions runs without it: call isDevChecks()',
		reaches: ['src/lib/env.ts'],
		hits: ["import { DEV } from 'esm-env';", 'import { BROWSER, DEV } from "esm-env";'],
		misses: ["import { isDevChecks } from '../env';"]
	},
	{
		id: 'the document is handed to a write as a body in one place',
		matches: /\bget\s+suffix\s*\(\s*\)/,
		allowed: {
			'src/lib/tree-operations/node-primitives.ts':
				'documentBody: the trailing blank line read and written through to the live document'
		},
		reason:
			'a getter over the document’s trailing blank line is a second document body beside documentBody: call documentBody',
		reaches: ['src/lib/tree-operations/node-primitives.ts'],
		hits: [
			'const p = { children, get suffix() { return doc.suffix; } };',
			'const q = { get  suffix ( ) { return s; } };'
		],
		misses: [
			'const body = documentBody(doc, children);\nconst s = body.suffix;',
			'const o = { get suffixes() { return []; } };',
			'// a `get suffix()` literal belongs in documentBody\nconst a = 1;'
		]
	},
	{
		id: 'G4.5 no synthetic KeyboardEvent in editor runtime',
		matches: /new\s+KeyboardEvent\s*\(/,
		reason:
			're-firing a key at document.activeElement re-enters a block keydown handler and bypasses the command registry',
		hits: ["new KeyboardEvent('keydown', { key: 'a' })", 'new  KeyboardEvent (e)'],
		misses: [
			'function f(e: KeyboardEvent): void {}\n' +
				'if (active instanceof KeyboardEvent) {}\n' +
				'const handler = (e: KeyboardEvent) => e.key;'
		]
	},
	{
		id: 'G1.4 only the editor root provides HISTORY_KEY',
		matches: /setContext\s*\(\s*HISTORY_KEY\b/,
		allowed: { 'src/lib/components/Editor.svelte': 'the editor root, the one provider' },
		reason:
			'a container re-providing HISTORY_KEY gives its descendants a second history object and splits the undo stack',
		hits: ['setContext(HISTORY_KEY, x)', 'setContext( HISTORY_KEY , bundle.history )'],
		misses: [
			'const history = getContext<HistoryActions>(HISTORY_KEY);\n' +
				"export const HISTORY_KEY = Symbol('history-actions');"
		]
	},
	{
		id: 'an edit reaches the live region only through a commit’s announcement',
		matches: /\bannounceEdit\b/,
		allowed: {
			'src/lib/editor-actions/commit/undo-controller.ts':
				'the commit, which speaks only when bytes landed',
			'src/lib/editor-actions/index.ts': 'hands the announcer to the undo controller alone',
			'src/lib/components/Editor.svelte': 'owns the live region and builds the controller'
		},
		reason:
			'the announcer reaches only the undo controller; held anywhere else, a refused, failed or discarded edit could still tell a screen reader it happened. Pass `announce` to the commit',
		hits: ['deps.announceEdit(message)', 'const { announceEdit } = (deps as any).root.deps;'],
		misses: ["announce: () => 'Deleted row',\nconst announcement = editAnnouncement;"]
	},
	{
		id: 'G4.14 component props reading the CST are typed as readonly views',
		population: svelteOnly,
		matches: /\b(node|document|doc)\??\s*:\s*(CstNode|Document)\b/,
		allowed: {
			'src/lib/components/Editor.svelte': 'the document-owning root holds the one mutable Document'
		},
		reason:
			'a component prop reading the CST is typed NodeView/DocumentView (G1.9); retype the prop to a view',
		hits: [
			at('x.svelte', 'let { node }: { node: CstNode } = $props();'),
			at('x.svelte', 'document?: Document;'),
			at('x.svelte', 'doc: Document;')
		],
		misses: [
			at(
				'x.svelte',
				'let { node, index }: { node: NodeView; index: number } = $props();\ndocument?: DocumentView;'
			),
			'let { node }: { node: CstNode } = $props();'
		]
	},
	{
		id: 'G4.66 a relative scroll is written through scrollBy',
		population: except('src/lib/cursor/scrollport.ts'),
		matches: /setScrollTop\s*\([^;]*?\.scrollTop\s*\(\s*\)/,
		reason:
			'a relative scroll goes through port.scrollBy(delta), which keeps the fraction the scroller refuses (#315)',
		reaches: [
			'src/lib/reactivity/list-windowing.svelte.ts',
			'src/lib/components/editor-root-geometry.ts'
		],
		hits: [
			'port.setScrollTop(port.scrollTop() + delta);',
			'el.setScrollTop(el.scrollTop() - lost);'
		],
		misses: [
			'port.setScrollTop(target);\nconst at = port.scrollTop();',
			'port.setScrollTop(listTopInPort(port, listEl) + model.offsetOf(index));'
		]
	},
	pairing(
		'G4.51 the controller: no file pushes a debounced checkpoint without arming the pause',
		/\bpushUndoSnapshotDebounced\s*\(/,
		/\barmUndoPause\s*\(/,
		'pushUndoSnapshotDebounced',
		'armUndoPause'
	),
	{
		id: 'G4.15 every bare `as <Brand>` cast lives in the brand’s home module',
		matches: (file) =>
			[...file.code.matchAll(BRAND_CAST_RE)].some(
				(m) => !BRAND_CAST_HOME[m[1]].includes(file.relPath)
			),
		reason: 'a coordinate brand is cast only where it is declared; use its as<Brand>() conversion',
		hits: BRANDS.map((brand) => `const x = n as ${brand};`),
		misses: [BENIGN_BRAND_USES]
	},
	{
		id: 'G4.15 every `as<Brand>()` conversion lives in a declared home or boundary file',
		matches: MINT_CALL_RE,
		allowed: {
			[COORDINATE_HOME]: 'the numeric-space conversions themselves',
			[DOCPATH_HOME]: 'the DocPath brand and its base conversion (asDocPath)',
			// Modules that own a coordinate space.
			'src/lib/cursor/widget-offset.ts': 'DomTextOffset home: the walk brands its returns',
			'src/lib/cursor/sticky-measure.ts': 'EditorX/ViewportX home + walk-offset candidate scan',
			'src/lib/cursor/surface-backend.ts':
				'RawOffset home for the caret intent a block records as a plain number (the snap target)',
			'src/lib/selection/table-endpoint-snap.ts':
				'CellIndex home: a row-major cell index from table geometry',
			'src/lib/selection/primitives.ts':
				'SelectionPoint accessors brand RawOffset/CellIndex for the char/cell branch reads',
			'src/lib/editor-actions/block-edit-scope.ts':
				'DocPath home: the scope factories brand the commit args’ document-absolute paths',
			'src/lib/editor-actions/commit/undo-controller.ts':
				'DocPath at the commit sequence, gating the G1.16 guard entry',
			// Public boundaries, where plain-number offsets are branded on entry.
			'src/lib/components/blocks/editable-surface.ts':
				'BlockComponent boundary: public number offsets branded at entry',
			'src/lib/components/blocks/editable-leaf.ts':
				'plugin-leaf surface: zero-prefix DOM-text mutations brand raw offsets in place',
			'src/lib/components/blocks/code/CodeBlock.svelte':
				'code surface: zero-prefix DOM-text mutations brand raw offsets in place',
			'src/lib/components/blocks/text/TextEditableBlock.svelte':
				'pending-caret restore holds a plain number field',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'zero-prefix cell: pending-caret restore + focus-offset walk read brand across the identity',
			'src/lib/components/blocks/table/TableBlock.svelte':
				'table sticky-X exit re-enters the editor column state',
			'src/lib/components/blocks/text/widget-interaction.ts':
				'CST inline offsets (unbranded model values) enter cursor IO',
			'src/lib/selection/multi-click.ts':
				'the point probe’s raw offsets and the segmenter’s walk-text indices (both unbranded) cross the walk in each direction'
		},
		reason:
			'a boundary conversion is a new declared entry into a coordinate space: add the file with the reason its plain value cannot be branded yet',
		hits: BRANDS.map((brand) => `f(as${brand}(3));`),
		misses: [BENIGN_BRAND_USES]
	},
	{
		id: 'the block-path attribute is parsed in one reader',
		population: (file) => /data-block-path|dataset\.blockPath/.test(file.code),
		matches: /JSON\.parse\s*\(/,
		allowed: {
			'src/lib/selection/path-lookup.ts':
				'readBlockPath: the one parse, and the shape check with it'
		},
		reason:
			'a second parse of `data-block-path` drifts from the shape check the shared reader applies; read it through readBlockPath',
		hits: ['const raw = el.dataset.blockPath;\nconst p = JSON.parse(raw) as number[];'],
		misses: [
			"const host = el.closest('[data-block-path]');\nreadBlockPath(host);",
			'const parsed = JSON.parse(payload);'
		]
	},
	{
		id: 'G4.13 no view-stripping cast outside tree-operations and the commit sequence',
		population: notUnder(
			'src/lib/tree-operations/',
			'src/lib/editor-actions/commit/',
			'src/lib/core/nodes.ts'
		),
		matches: stripsView,
		mustMatch: ['src/lib/tree-operations/unshare.ts'],
		reason:
			'a CstNode/Document cast re-opens the byte-write hazard G1.9 closes in the types; route through makeBlockNode or the copy-before-write module instead',
		hits: [
			'const n = view as CstNode;',
			'const n = doc as unknown as CstNode;',
			`${CST_IMPORT}const d = view as Document;`,
			`${CST_IMPORT}const d = (x as Document & { y?: number }).y;`,
			'x as CstNode | null'
		],
		misses: [
			"meta as CstNode['metadata']",
			'node as NodeView',
			'doc as DocumentView',
			'const node: CstNode = fresh();',
			'el.ownerDocument as Document & { caretRangeFromPoint?: never }',
			"import type { SelectionPoint } from './primitives';\nconst d = view as Document;",
			'// never write `x as CstNode` here\nconst a = 1;'
		]
	},
	{
		id: 'the inline widget length gate reads the CST, never the DOM',
		population: under(DECORATIONS_DIR),
		matches: (file) => DOM_MEASURES.some((re) => re.test(file.code)),
		allowed: {},
		reason:
			'a decoration module measuring rendered text reads a container the render pass is still rewriting; the ContentLength brand carries the CST range',
		reaches: [`${DECORATIONS_DIR}island-dom.ts`],
		atLeast: 4,
		hits: [
			at(`${DECORATIONS_DIR}rogue.ts`, 'const bound = (root.textContent ?? "").length;'),
			at(`${DECORATIONS_DIR}rogue.ts`, 'const n = el.textContent.length;'),
			at(`${DECORATIONS_DIR}rogue.ts`, 'const n = containerDomTextLength(root);'),
			at(`${DECORATIONS_DIR}rogue.ts`, 'const n = rawTextOfNode(root, raw).length;')
		],
		misses: [
			at(
				`${DECORATIONS_DIR}x.ts`,
				'if (islands.length === 0) return [];\n' +
					'const displaced = rawTextOfNode(extracted, raw);\n' +
					'el.textContent = raw;\n' +
					'// root.textContent.length would be the wrong bound\n'
			),
			'const n = el.textContent.length;'
		]
	},
	{
		id: 'the ContentLength brand is cast only where it is created',
		matches: /\bas\s+ContentLength\b/,
		allowed: { 'src/lib/core/inline/index.ts': 'the brand’s one conversion' },
		reason: 'the inline widget length has one source, the CST content range',
		hits: ['const n = x as ContentLength;'],
		misses: ['const n: ContentLength = contentLengthOf(x);']
	},
	{
		id: 'G4.32 one spelling for the inline cache: no consumer reaches for the raw accessor',
		population: except('src/lib/core/inline/inline-cache.ts'),
		matches: /(?<![\w.])getInlineContent\s*\(/,
		allowed: {
			'src/lib/core/inline/transparency.ts':
				'the vertical-skip decision, run by path walkers holding no linkRef; its header states the resolver-less answer as its contract'
		},
		reason:
			'a caller dropping the resolver or the signature reads a different cache sub-entry from the one the render filled; go through resolvedInlineContent',
		hits: ['const x = getInlineContent(node);'],
		misses: ['cache.getInlineContent(node);', '// getInlineContent(node) would be wrong']
	},
	...surfaceParity(
		'G4.44 every prose surface resolves native ranged edits through resolveLiveRangeEdit',
		LIVE_EDIT_HOME,
		RESOLVES_LIVE_EDIT,
		'resolveLiveRangeEdit(e, node, cursor, m, r);',
		'a prose surface reads the pending range off getTargetRanges() through resolveLiveRangeEdit; the live selection alone loses every word, line and drag delete at a collapsed caret'
	),
	...surfaceParity(
		'G4.65 every prose surface hands typed delimiters to applyDelimiterAutoPair',
		AUTOPAIR_HOME,
		APPLIES_AUTOPAIR,
		'applyDelimiterAutoPair(e, deps);',
		'a prose surface hands its typed delimiters to applyDelimiterAutoPair, which pairs, steps over and closes them; a local copy drifts'
	),
	{
		id: 'G4.39 every component mounting the text surface publishes runCommand',
		population: (file) => svelteOnly(file) && COMMAND_SURFACE_RE.test(file.code),
		matches: (file) => !PUBLISHES_RUN_COMMAND_RE.test(file.code),
		reason:
			'without an instance export of runCommand, editor.runCommand() declines every built-in text command on that block',
		reaches: ['src/lib/components/blocks/table/TableCellBlock.svelte'],
		atLeast: 3,
		hits: [
			at('x.svelte', 'const s = createEditableSurface({'),
			at('x.svelte', 'createEditableSurface({}); const x = component.runCommand;'),
			at('x.svelte', 'createEditableSurface({}); if (!component?.runCommand) return null;')
		],
		misses: [
			at('x.svelte', 'const leaf = createEditableLeaf({'),
			at('x.svelte', 'if (wiring.dispatchChord(e, { kind, getPath }))'),
			at('x.svelte', 'createEditableSurface({}); export const runCommand = surfaceRunCommand;'),
			at(
				'x.svelte',
				'createEditableSurface({}); export function runCommand(id: CommandId): boolean {'
			),
			'const s = createEditableSurface({'
		]
	},
	{
		id: 'G4.73 every component mounting an editable leaf publishes afterSourceCommit',
		population: (file) => svelteOnly(file) && LEAF_SURFACE_RE.test(file.code),
		matches: (file) => !PUBLISHES_SOURCE_COMMIT_RE.test(file.code),
		reason:
			'without an instance export of afterSourceCommit, editor.runCommand moves the block with its open source unwritten and the edit is lost; a bound chord gets the hook from the leaf itself',
		reaches: ['src/lib/plugins/latex/BlockMath.svelte'],
		atLeast: 4,
		hits: [
			at('x.svelte', 'const leaf = createEditableLeaf({'),
			at('x.svelte', 'createEditableLeaf({}); const run = leaf.afterSourceCommit;')
		],
		misses: [
			at(
				'x.svelte',
				'createEditableLeaf({}); export const afterSourceCommit = leaf.afterSourceCommit;'
			),
			at('x.svelte', 'const s = createEditableSurface({'),
			'const leaf = createEditableLeaf({'
		]
	},
	{
		id: 'G4.47 every [contenteditable] selector read answers for the whole-block host',
		population: (file) => SELECTOR_READ_RE.test(file.code),
		matches: (file) => !HOST_AWARE_RE.test(file.code),
		allowed: {
			'src/lib/active-editor.ts': 'the host IS a text-entry surface: a focus move must yield to it',
			'src/lib/invariants/landable-caret.ts':
				'G1.33 resolves the host as the focused editable and does nothing on its emptiness',
			'src/lib/selection/caret-restore.ts':
				'a caret saved at whole-block focus restores TO the host, the wanted target',
			'src/lib/selection/cross-block/pointer.ts':
				'a shift-click anchored on a whole-block kind resolves to the host, so the dispatch takes the unit whole'
		},
		reason:
			'route through isEditableEventTarget/isWholeBlockInputProxy, or declare what this reader answers for the whole-block host',
		hits: [
			'wrapper.querySelector(\n\t`[contenteditable]:not([${ATTR}])`\n)',
			"host.closest<HTMLElement>('[contenteditable]')",
			'el.matches(\'[contenteditable]:not([contenteditable="false"])\')'
		],
		misses: [
			"el.setAttribute('contenteditable', 'false')",
			"wrapper.querySelector('[data-block-path]')",
			"host.closest<HTMLElement>('[contenteditable]'); isEditableEventTarget(t);"
		]
	},
	{
		id: 'G4.47 every activeElement identity read answers for the whole-block host',
		population: (file) => ACTIVE_IDENTITY_RE.test(file.code),
		matches: (file) => !HOST_AWARE_RE.test(file.code),
		allowed: {
			'src/lib/cursor/surface-backend.ts':
				'the editable surface this backend was built over; a whole-block kind builds none',
			'src/lib/components/blocks/editable-surface.ts':
				'the pending-restore guard, reachable only from an editable leaf surface',
			'src/lib/cursor/reveal-source.ts':
				'the reveal target is a text surface; the host paints no source',
			'src/lib/selection/native-bridge.ts':
				'blockEl is an editable leaf surface; neither entry is reachable from whole-block focus'
		},
		reason:
			'route through isEditableEventTarget/isWholeBlockInputProxy, or declare what this reader answers for the whole-block host',
		hits: [
			'document.activeElement === focusSurfaceEl()',
			'if (document.activeElement !== container) return null;',
			'const applied = el === document.activeElement;'
		],
		// A whole-block kind holds focus through the host, so containment is how a correct reader asks.
		misses: [
			'!!boxEl?.contains(document.activeElement)',
			'if (document.activeElement === surfaceEl) return null; holdsWholeBlockFocus(el);'
		]
	},
	{
		id: 'G4.71 an emptiness test on text reads GFM blank, not String.trim()',
		matches: EMPTY_BY_TRIM,
		allowed: {
			'src/lib/schema/block-kind-descriptor.ts':
				'a kind’s accessible label, which no document holds',
			'src/lib/components/menu/default-context-actions.ts':
				'the paste menu row skips a clipboard that holds nothing to paste',
			'src/lib/components/link-card/LinkCard.svelte': 'a URL typed into the link card',
			'src/lib/components/link-card/LinkCardHost.svelte': 'a URL typed into the link card',
			'src/lib/core/inline/link-source-bytes.ts': 'the URL the link command was given',
			'src/lib/plugins/latex/BlockMath.svelte':
				'whether the render shows ink, not whether the Markdown is blank',
			'src/lib/plugins/mermaid/MermaidBlock.svelte':
				'whether the render shows ink, not whether the Markdown is blank'
		},
		reason:
			'`trim()` also drops a non-breaking space, which GFM (§2.1) counts as content: test document text with `isBlankText` (core/lines.ts), or allow a string that is no document text here, with why',
		hits: [
			"if (child.raw.trim() === '') return;",
			"const empty = x.trim() !== '';",
			'if (body.trim().length === 0) return;',
			'if (!node.raw.trim()) return;'
		],
		misses: [
			'if (isBlankText(child.raw)) return;',
			"onCommit(value.trim() === 'text' ? '' : value);",
			'const info = raw.trim();',
			"if (!line.trim().startsWith('|')) return;"
		]
	},
	{
		id: 'G4.72 the Markdown grammar reads GFM whitespace, not JS \\s or trim()',
		population: (file) =>
			under('src/lib/core/parsers/')(file) ||
			GRAMMAR_FILES.includes(file.relPath) ||
			PLUGIN_GRAMMAR_DIRS.some((dir) => under(dir)(file)),
		matches: /\\[sS]|\.trim(?:Start|End)?\(/,
		allowed: {
			'src/lib/plugins/latex/flanking.ts':
				'the `$` flanking rule reads Unicode whitespace, as emphasis does',
			'src/lib/plugins/latex/renderer.ts': 'the text of a KaTeX error message',
			'src/lib/plugins/latex/BlockMath.svelte': SHOWS_INK,
			'src/lib/plugins/mermaid/MermaidBlock.svelte': SHOWS_INK,
			'src/lib/plugins/slash-commands/slash-source.ts':
				'where a typed `/` opens the command menu: a word boundary in typing, not Markdown',
			'src/lib/plugins/slash-commands/filter.ts': 'the words of a menu query the user typed'
		},
		reaches: [...GRAMMAR_FILES, 'src/lib/core/directive/grammar.ts'],
		reason:
			'JS `\\s` and `trim()` admit a non-breaking space, and GFM (§2.1) never does: a rule wanting spaces or tabs says `[ \\t]`, one wanting whitespace reads `WHITESPACE_CLASS`, `isWhitespaceChar` or `trimWhitespace` (core/lines.ts)',
		hits: [
			at(PARSER_PROBE, 'const m = text.match(/^#(?:\\s|$)/);'),
			at(PARSER_PROBE, 'new RegExp(`^x\\\\s*$`);'),
			at(PARSER_PROBE, 'const trimmed = text.trim();'),
			at(PARSER_PROBE, 'const head = text.trimStart();'),
			at(PARSER_PROBE, 'const tail = text.trimEnd();'),
			at('src/lib/core/inline/scan/autolinks.ts', 'const m = s.match(/^(\\S+)/);'),
			at('src/lib/plugins/latex/latex-kind.ts', 'const isSpace = (ch: string) => /\\s/.test(ch);'),
			at('src/lib/core/directive/grammar.ts', 'const title = info.trim();')
		],
		misses: [
			at(PARSER_PROBE, 'const m = text.match(/^#(?:[ \\t]|$)/);'),
			at(PARSER_PROBE, 'isWhitespaceChar(ch); // JS \\s is too wide'),
			at(PARSER_PROBE, 'const info = trimWhitespace(raw);'),
			at('src/lib/core/inline/scan/emphasis.ts', 'return /\\s/.test(ch);'),
			at('src/lib/plugins/mermaid/mermaid-kind.ts', 'const match = /^([`~]+)(.*)$/s.exec(raw);')
		]
	},
	{
		id: 'the theme and mode a host leaves unset are defaulted once, by the editor',
		// Single quotes in the default: a markup attribute (`theme="light"`) is a host passing one.
		matches: /(?:\?\?|\|\|)\s*['"](?:dark|light)['"]|\b(?:theme|presentationMode)\s*=\s*'/,
		allowed: {
			'src/lib/components/Editor.svelte': 'the prop defaults every reader is handed'
		},
		reason:
			'a reader defaulting the theme itself can draw in a theme the editor is not in: read the required getter the editor passes down (`EditorPolicies.theme`, a widget’s `getTheme`)',
		hits: [
			"const theme = getTheme?.() ?? 'dark';",
			"toMermaidTheme(context?.theme || 'light');",
			"let { theme = 'dark' } = $props();",
			"let { presentationMode = 'source' } = $props();"
		],
		misses: [
			'const theme = getTheme();',
			"if (theme === 'dark') return;",
			'<Editor {source} theme="light" />',
			"const MERMAID_THEMES = new Set(['default', 'dark']);"
		]
	},
	{
		id: 'G4.74 only the commit writes the open last line',
		matches: /\b(?:terminateLastLine|releaseLastLine)\b/,
		allowed: {
			'src/lib/tree-operations/open-tail.ts':
				'the walk down the last line, private to the two steps every structural commit runs'
		},
		reason:
			'the commit ends every placed line and gives the ending back to the last block; an edit that writes the tail itself is a second copy of that rule, and the next route will not carry it',
		hits: ['terminateLastLine(node, ending, sharing);', 'releaseLastLine(tail, sharing);'],
		misses: ['endWindowLines(body, change, sharing);', 'text = terminateLine(text, ending);']
	},
	{
		id: 'a value the editor owns is read through its getter, never optional-chained into a default',
		matches: new RegExp(
			`\\b(?:${EDITOR_GETTERS.join('|')})\\?\\.\\(|(?:\\?\\?|\\|\\|)\\s*'(?:source|reading)'`
		),
		allowed: {
			'src/lib/cursor/widget-offset.ts':
				'the mode a mounted block wears in the DOM, where no hiding attribute means source'
		},
		reason:
			'the editor passes every one of these getters and decides each default once, so a reader’s own fallback can only disagree with it: call the getter as given',
		hits: [
			"const isReading = (getPresentationMode?.() ?? 'source') === 'reading';",
			'const on = $derived(getDragHandles?.() ?? false);',
			'const doc = getDocument?.();',
			'if (path) void navigateTo?.(path);',
			"const mode = policies.presentationMode() || 'source';"
		],
		misses: [
			"const isReading = getPresentationMode() === 'reading';",
			'navigateTo: (path) => rects?.navigateTo(path) ?? Promise.resolve(false),',
			"if (mode === 'reading') return;"
		]
	},
	// Miss-analysis: `isGridKind` had no scan behind it, so a site holding a descriptor kept
	// comparing its `containerContract` to `'grid'` itself.
	{
		id: 'G4.78 the grid contract is read through isGridKind',
		matches: readsGridLiteral,
		allowed: {
			'src/lib/schema/block-kind-descriptor.ts':
				'isGridKind and isGridDescriptor, the one place the comparison is written',
			'src/lib/schema/insert-catalogue.ts':
				'the table entry’s search keyword, a word the insert menu filters on'
		},
		reason:
			'a kind is a grid when its descriptor declares the grid contract, and a second spelling of that test drifts from the first: call `isGridKind(kind)`, or `isGridDescriptor(descriptor)` where the descriptor is in hand',
		hits: [
			"if (descriptor.containerContract === 'grid') return;",
			"} else if (contract !== 'grid' || last < 0) {",
			"const grid = 'grid' === d?.containerContract;",
			"switch (contract) {\n\tcase 'grid':\n\t\treturn 1;\n}",
			"if (['strip', 'grid'].includes(contract)) return;",
			"const grids = new Set(['grid']);",
			'const a = contract === `grid`;',
			"const b = contract ===\n\t\t\t\t\t\t\t'grid';",
			"const c = contract || 'grid';",
			at(
				'src/lib/components/X.svelte',
				'{#if descriptor.containerContract === "grid"}<p>row</p>{/if}'
			)
		],
		misses: [
			"container: { contract: 'grid', rebuildRaw: rebuildTableRaw },",
			"containerContract?: 'strip' | 'grid' | 'opaque';",
			"type Contract = 'grid' | 'strip';",
			"// descriptor.containerContract === 'grid' marks a table\nconst a = 1;",
			'const note = "a table is containerContract === \'grid\'";',
			at('src/lib/components/X.svelte', "<p>when contract === 'grid' the rows lay out</p>")
		]
	}
];

describeFileRules(RULES, collectEditorSources());
