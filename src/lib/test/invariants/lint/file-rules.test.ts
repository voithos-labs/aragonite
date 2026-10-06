/**
 * File rules over the shipped source: each row names a shape a file may not hold, the files
 * allowed to hold it, and the snippets its matcher must flag or spare. The scan is `file-rule.ts`;
 * a row carries its G-number where the invariant catalog has one, and every row reads the one
 * source collection taken below.
 */

import { describe, it, expect } from 'vitest';
import {
	balancedBlock,
	balancedCall,
	callArguments,
	collectEditorSources,
	enclosingFunction,
	fileClasses,
	isProseSurface,
	languageOf,
	LEXICAL_CLASSES,
	type SourceFile
} from './scan-source';
import {
	describeFileRules,
	describeManifests,
	except,
	notUnder,
	svelteOnly,
	probeFile,
	under,
	type FileRule,
	type ManifestRule,
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

// ── Editable surfaces ────────────────────────────────────────────────────────

// A file that mounts a text surface someone presses into: a markup attribute or a textarea, a
// script-set attribute that can read true, or the props object a leaf spreads onto its source.
const MOUNTS_EDITABLE = [
	/\scontenteditable=(?:\{|"true")/,
	/<textarea\b/,
	/setAttribute\(\s*'contenteditable',[^;]*'true'/,
	/\bcontenteditable:\s/
];

// A method call too: every surface reaches the handler through its cross-block bundle.
const SHARED_PRESS_CALL = /\bhandlePointerDown\s*\(/g;
const PRESS_BINDING = /\bonpointerdown(?:=\{|:\s*)(\w+)\s*[},]/g;

/** A file that mounts an editable surface whose pointerdown handlers do not each call the shared
 *  press handler exactly once: one call a branch cannot skip, and no second copy to fall back on. */
function skipsSharedPress(file: SourceFile): boolean {
	if (!MOUNTS_EDITABLE.some((re) => re.test(file.code))) return false;
	const names = [...file.code.matchAll(PRESS_BINDING)].map((m) => m[1]);
	if (names.length === 0) return true;
	return names.some((name) => {
		const body = functionBody(file.code, name);
		return body === null || (body.match(SHARED_PRESS_CALL) ?? []).length !== 1;
	});
}

/** The body of `function name(…) {…}`; null where the file declares no such function. */
function functionBody(code: string, name: string): string | null {
	const head = new RegExp(String.raw`\bfunction\s+${name}\s*\(`).exec(code);
	if (!head) return null;
	const afterParen = head.index + head[0].length;
	const params = balancedCall(code, afterParen);
	const open = params === null ? -1 : code.indexOf('{', afterParen + params.length);
	return open < 0 ? null : balancedBlock(code, open + 1);
}

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

// ── G4.79 the grid contract ──────────────────────────────────────────────────

const CODE = LEXICAL_CLASSES.indexOf('code');
const QUOTED_GRID = /(['"`])grid\1/g;
const DECLARED_BEFORE = /\b(?:contract|containerContract)\??\s*:\s*$/;
const UNION_BEFORE = /(?<!\|)\|\s*$/;
const UNION_AFTER = /^\s*\|(?!\|)/;
const ATTRIBUTE_BEFORE = /\s[\w:-]+=$/;

/** Whether a whole `'grid'` literal in code reads the contract: every one does but a declaration
 *  (`contract: 'grid'`), a member of the contract's union type, and a markup attribute's value. */
function readsGridLiteral(file: SourceFile): boolean {
	const classes = fileClasses(file);
	const markup = languageOf(file.relPath) === 'component';
	for (const { index, 0: literal } of file.code.matchAll(QUOTED_GRID)) {
		const end = index + literal.length;
		const whole = classes[index] !== CODE && (index === 0 || classes[index - 1] === CODE);
		if (!whole || (end < file.code.length && classes[end] !== CODE)) continue;
		const before = file.code.slice(Math.max(0, index - 64), index);
		const after = file.code.slice(end, end + 64);
		if (DECLARED_BEFORE.test(before)) continue;
		if (UNION_BEFORE.test(before) || UNION_AFTER.test(after)) continue;
		if (markup && ATTRIBUTE_BEFORE.test(before)) continue;
		return true;
	}
	return false;
}

// ── G4.85, G4.86 where a leaf's bytes are stored ─────────────────────────────

const TEXT_BLOCK_DIR = 'src/lib/components/blocks/text/';
const LIVE_EDIT_DIR = 'src/lib/core/inline/live-edit/';
const LIVE_EDIT_PROBE = `${LIVE_EDIT_DIR}probe.ts`;

/** The text block's helper modules, where every live rewrite lives, and the live-edit readers. */
const holdsLiveRewrites = (file: SourceFile): boolean =>
	file.relPath.startsWith(LIVE_EDIT_DIR) ||
	(file.relPath.startsWith(TEXT_BLOCK_DIR) &&
		/^[^/]+\.ts$/.test(file.relPath.slice(TEXT_BLOCK_DIR.length)));

/** A read of a list item's marker: off its metadata, or off a parse cast to carry one. */
const LIST_MARKER_READ =
	/\{\s*marker\?:\s*string\s*\}|'listItem'\)\??\.marker\b|\b\w*[mM]eta(?:data)?\??\.marker\b/;

// ── The rules ────────────────────────────────────────────────────────────────

/** A file the G4.80 population holds, for its probes. */
const SELECTION_PROBE = 'src/lib/selection/probe.ts';

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
			'src/lib/plugins/highlight-occurrences/highlight-occurrences-plugin.ts':
				'setTimeout typing pause before the occurrence marks return, a pause detection tick() cannot express',
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
		id: 'G4.99 a windowed list keeps its table height while blocks mount',
		population: svelteOnly,
		// Any spacer in markup (a class list, an expression, a `class:` directive), not a style rule.
		matches: (file) =>
			/\bclass(?::vr-spacer\b|=["'{][^>]*\bvr-spacer\b)/.test(file.code) &&
			!/\buseWindowFloor\s*\(/.test(file.code),
		reason:
			'a list that renders spacers mounts its new blocks one by one, and a layout read in between clamps the scroll at the document end: call `useWindowFloor` with the box around the spacers',
		reaches: [
			'src/lib/components/BlockList.svelte',
			'src/lib/components/blocks/list/ListBlock.svelte',
			'src/lib/components/blocks/table/TableBlock.svelte'
		],
		hits: [
			at('x.svelte', '<div class="rows">\n<div class="vr-spacer" style="height: 4px"></div>'),
			at('x.svelte', '<div class="gap vr-spacer"></div>'),
			at('x.svelte', "<div class={'vr-spacer'}></div>"),
			at('x.svelte', '<div class:vr-spacer={on}></div>')
		],
		misses: [
			at('x.svelte', '<style>\n\t.vr-spacer {\n\t\tflex: none;\n\t}\n</style>'),
			at(
				'x.svelte',
				'useWindowFloor(() => rowsEl, () => win);\n<div class="rows">\n<div class="vr-spacer"></div>'
			),
			at('x.svelte', '<div class="rows"></div>'),
			'const spacer = \'<div class="vr-spacer"></div>\';'
		]
	},
	{
		id: 'G4.66 a relative scroll is written through scrollBy',
		population: except('src/lib/cursor/scrollport.ts'),
		matches: /setScrollTop\s*\([^;]*?\.scrollTop\s*\(\s*\)/,
		reason:
			'a relative scroll goes through port.scrollBy(delta), which keeps the fraction the scroller refuses (#315)',
		reaches: ['src/lib/cursor/scroll-owner.ts'],
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
		id: 'the browser is asked for a caret at a point in one module',
		matches: /\bcaret(Range|Position)FromPoint\b/,
		allowed: {
			'src/lib/cursor/point-offset.ts':
				'caretSeatFromPoint, behind the offset lookups that move a padding point level with a line'
		},
		reason:
			'Mac and Linux Chromium answer a point in an element’s top or bottom padding with the line’s start or end: resolve a point through offsetFromViewportPoint or caretOffsetAtPoint',
		hits: [
			'const r = document.caretRangeFromPoint(x, y);',
			'const p = (doc as any).caretPositionFromPoint?.(x, y);'
		],
		misses: [
			'const offset = offsetFromViewportPoint(el, x, y);',
			'const seat = caretSeatFromPoint(document, x, y);',
			'// never call caretRangeFromPoint here\nconst a = 1;'
		]
	},
	{
		id: 'every editable surface hands each press to the shared press handler once',
		matches: skipsSharedPress,
		allowed: {
			'src/lib/components/GapCaret.svelte':
				'the caret between blocks holds no text, so a press there has no line to land on',
			'src/lib/editor-actions/whole-block-focus-surface.ts':
				'the hidden editing host behind a whole block takes focus, never a press',
			'src/lib/plugins/mermaid/MermaidBlock.svelte':
				'the diagram source is a textarea, a form control that places its own caret, with no DOM text for the probe',
			'src/lib/invariants/marker-css-parity.ts':
				'the dev check measures a detached probe element nobody presses'
		},
		reason:
			'the browser places a press in an editable’s top or bottom padding at the line’s start or end on Mac and Linux; bind the surface’s pointerdown to a named function that calls crossBlock.handlePointerDown exactly once, or allow it here with why',
		reaches: [
			'src/lib/components/blocks/code/CodeBlock.svelte',
			'src/lib/components/blocks/table/TableCellBlock.svelte',
			'src/lib/components/blocks/text/TextEditableBlock.svelte',
			'src/lib/components/blocks/editable-leaf.ts'
		],
		hits: [
			at('x.svelte', '<div contenteditable="true"></div>'),
			at(
				'x.svelte',
				'<div contenteditable="true" onpointerdown={down}></div>\nfunction down(e) { if (e.shiftKey) return; }'
			),
			at(
				'x.svelte',
				"<div\n\tcontenteditable={ro ? 'false' : 'true'}\n\tonpointerdown={down}\n></div>\n" +
					'function down(e) { if (a) { x.handlePointerDown(e); return; } x.handlePointerDown(e, o); }'
			),
			at('x.svelte', '<textarea bind:value={draft}></textarea>'),
			"el.setAttribute('contenteditable', reading ? 'false' : 'true');",
			"const props = { contenteditable: 'true' as const, onpointerdown: (e) => {} };"
		],
		misses: [
			at(
				'x.svelte',
				'<div contenteditable="true" onpointerdown={down}></div>\n' +
					'function down(e: PointerEvent): void { if (!el) return; crossBlock.handlePointerDown(e); }'
			),
			"const on = { contenteditable: 'true' as const, onpointerdown: down };\nfunction down(e) { void crossBlock.handlePointerDown(e); }",
			at('x.svelte', '<span contenteditable="false">x</span>'),
			'root.querySelector(\'[contenteditable="true"]\');',
			"widget.setAttribute('contenteditable', 'false');"
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
		'resolveLiveRangeEdit(e, node, cursor, r);',
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
		id: 'G4.47 every [contenteditable] selector read answers for the whole-block host',
		population: (file) => SELECTOR_READ_RE.test(file.code),
		matches: (file) => !HOST_AWARE_RE.test(file.code),
		allowed: {
			'src/lib/active-editor.ts': 'the host IS a text-entry surface: a focus move must yield to it',
			'src/lib/invariants/landable-caret.ts':
				'G1.33 resolves the host as the focused editable and does nothing on its emptiness'
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
		hits: [
			'terminateLastLine(node, ending, sharing, grammar);',
			'releaseLastLine(tail, sharing, grammar);'
		],
		misses: [
			'endWindowLines(body, change, sharing, grammar);',
			'text = terminateLine(text, ending);'
		]
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
	{
		id: 'G4.77 only the editor bootstrap, registerCore and directives register on behalf of no plugin',
		// The bare name, so an aliased import is flagged at its import line.
		matches: /\bregisterAsCore\b/,
		allowed: {
			'src/lib/schema/plugin-install.ts':
				'the function itself, which runs its callback with no plugin installing',
			'src/lib/components/editor-built-ins.ts':
				'the editor’s own bootstraps (blocks, code languages, context-menu rows), which the reset keeps',
			'src/lib/schema/plugin-registry.ts':
				'`registerCore`, which also flags a key the registry can’t tell is built-in so the reset keeps it',
			'src/lib/components/blocks/directive/activate-directives.ts':
				'the directive grammar and its components, which a consumer may turn on from a plugin’s setup and the reset drops'
		},
		reason:
			'an entry belongs to no plugin only through one of these routes: an editor built-in goes in `registerEditorBuiltIns`, a built-in key the reset can’t recognize goes through `registerCore`, and a kind a plugin declared already answers to that plugin',
		hits: [
			'registerAsCore(() => registerLanguage(name, grammar));',
			"import { registerAsCore as runUnowned } from './plugin-install';"
		],
		misses: ['grammars.registerCore(key, language);', 'registerAsCoreLater();']
	},
	{
		id: 'G4.78 the editor’s built-in bootstraps run only through registerEditorBuiltIns',
		matches:
			/\b(?:registerBuiltInBlocks|bootstrapCodeLanguages|registerDefaultContextActions)\s*\(/,
		allowed: {
			'src/lib/components/editor-built-ins.ts':
				'`registerEditorBuiltIns`, which runs the three bootstraps as no plugin',
			'src/lib/components/built-in-blocks.ts': 'the definition of `registerBuiltInBlocks`',
			'src/lib/components/blocks/code/code-bootstrap.ts':
				'the definition of `bootstrapCodeLanguages`',
			'src/lib/components/menu/default-context-actions.ts':
				'the definition of `registerDefaultContextActions`'
		},
		reason:
			'a bootstrap called anywhere else registers the editor’s built-ins as whichever plugin’s setup reached it first, so they resolve only where that plugin is listed and the test reset drops them: call `registerEditorBuiltIns()` instead',
		hits: [
			'bootstrapCodeLanguages();',
			'registerBuiltInBlocks ();',
			'registerDefaultContextActions();'
		],
		misses: [
			'registerEditorBuiltIns();',
			'registerBuiltInDescriptors();',
			'import { bootstrapCodeLanguages } from "./code-bootstrap";'
		]
	},
	// Miss-analysis: `isGridKind` had no scan behind it, so a site holding a descriptor kept
	// comparing its `containerContract` to `'grid'` itself.
	{
		id: 'G4.79 the grid contract is read through isGridKind',
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
			),
			at('src/lib/components/X.svelte', "<div class={contract === 'grid' ? 'a' : 'b'}>x</div>"),
			"el.style.display = 'grid';",
			"let c='grid';"
		],
		misses: [
			"container: { contract: 'grid', rebuildRaw: rebuildTableRaw },",
			"containerContract?: 'strip' | 'grid' | 'opaque';",
			"type Contract = 'grid' | 'strip';",
			"// descriptor.containerContract === 'grid' marks a table\nconst a = 1;",
			'const note = "a table is containerContract === \'grid\'";',
			at('src/lib/components/X.svelte', "<p>when contract === 'grid' the rows lay out</p>"),
			at('src/lib/components/X.svelte', '<div role="grid" style:display="grid">x</div>')
		]
	},
	{
		id: 'G4.80 in selection/ only the range coverage and the caret walks ask if a container is closed',
		population: under('src/lib/selection/'),
		matches: /(?<![\w.])(?:isCollapsedContainer|collapsedContainerHiding)\s*\(/,
		allowed: {
			'src/lib/selection/range-coverage.ts':
				'decides once which closed containers a range takes whole, for every reader of the range',
			'src/lib/selection/path-lookup.ts':
				'the caret walks step over a closed container’s hidden body; they place a caret and read no range',
			'src/lib/selection/caret-target.ts':
				'where a caret lands skips a hidden body unless the caller opens it; it reads no range'
		},
		reason:
			'a reader of a range asks `coverRange` what the range covers; one that asks a closed container itself can disagree with the delete and the copy',
		hits: [
			at(SELECTION_PROBE, 'if (isCollapsedContainer(node)) return removeWhole(doc, path);'),
			at(SELECTION_PROBE, 'const hidden = collapsedContainerHiding(doc, end.path);')
		],
		misses: [
			at(SELECTION_PROBE, "import { isCollapsedContainer } from '../schema/reserved-chrome';"),
			at(SELECTION_PROBE, 'const unit = range.unitHolding(start.path);')
		]
	},
	{
		id: 'G4.81 the cross-block row snap runs in the range coverage and the stored pair only',
		matches: /(?<![\w.])snapCrossBlockTableEndpoints\s*\(/,
		allowed: {
			'src/lib/selection/table-endpoint-snap.ts': 'defines it',
			'src/lib/selection/range-coverage.ts': 'snaps once for every reader of a range',
			'src/lib/selection/selection-state.svelte.ts':
				'the stored `start` and `end`, which the collapse keys, the undo seed and the extension paths read'
		},
		reason:
			'the delete, the copy and the overlay read the snapped pair from `coverRange`; a second snap is a second answer to what the range covers',
		hits: ['const { start, end } = snapCrossBlockTableEndpoints(doc, a, b);'],
		misses: ["import { snapCrossBlockTableEndpoints } from './table-endpoint-snap';"]
	},
	{
		id: 'G4.95 what a range covers is decided in the range coverage only',
		matches:
			/(?:^|[^\w.]|\.\.\.)(?:walkBetween|isPathSubtreeBetween|isPathBetween|cellRectBounds|lastChildDescendant|cellIndexOf|tableCellCount)\s*\(|\.unitHolding\s*\(/m,
		allowed: {
			'src/lib/selection/range-coverage.ts':
				'decides once what a range covers: the blocks between, the units, the edges, the cells, the rectangle',
			'src/lib/selection/path-math.ts': 'defines the two path predicates',
			'src/lib/cursor/coordinate-spaces.ts': 'defines the rectangle two cells span',
			'src/lib/selection/primitives.ts': 'defines the cell index read of a table endpoint',
			'src/lib/schema/block-kind-descriptor.ts':
				"defines a table's cell count and the clamp every cell index takes",
			'src/lib/selection/table-endpoint-snap.ts':
				'snaps a table endpoint to its row for `coverRange`, before any coverage exists',
			'src/lib/invariants/selection-endpoints.ts':
				"checks a stored cell endpoint lies inside its table's cells",
			'src/lib/selection/table-rect-extend.ts':
				"moves a rectangle's focus cell one step on Shift+arrow, an edit of the selection",
			'src/lib/selection/range-delete-table.ts':
				'puts the caret in the start cell once the coverage has said which cells clear'
		},
		reason:
			'the delete, the copy, the format toggle and the overlay read `rangeCoverage`; a walk, a rectangle, a unit check or cell arithmetic on an endpoint of their own is a second answer to what a range covers',
		hits: [
			'for (const path of walkBetween(doc, start.path, end.path)) {',
			'if (isPathBetween(path, start.path, end.path)) return "middle";',
			'const rect = cellRectBounds(anchor, focus, colCount);',
			'return { tablePath, ...cellRectBounds(anchor, focus, colCount) };',
			'const unit = range.unitHolding(start.path);',
			'const cellCount = tableCellCount(node);\nreturn lo === 0 && hi === cellCount - 1 ? anchor.path.slice() : null;',
			"? cellIndexOf(start, 'SelectionOverlay:start')",
			"const endOffset = cellIndexOf(end, 'SelectionOverlay:end') + 1;"
		],
		misses: [
			"import { walkBetween } from './range-coverage';",
			'const root = coverage.rootHolding(path);',
			'const { top, left } = grid.rect;',
			'const rect = bounds.cellRectBounds(anchor, focus);',
			'const { from, to } = endpointMeasureSpan(classification, live);',
			'const run = coverage.endCells;'
		]
	},
	{
		id: 'a removed block lands the caret by its gesture; only a range running on past it skips that',
		matches: /(?<![\w.])(?:survivorWhereRangeResumes|caretWhereRangeResumes)\s*\(/,
		allowed: {
			'src/lib/selection/caret-target.ts': 'defines the survivor read',
			'src/lib/selection/range-delete-chrome.ts':
				'defines the caret read, and a range that took its start container whole and runs on',
			'src/lib/selection/range-delete-table.ts': 'the same range, ending in a table'
		},
		reason:
			'`survivorAfterRemoval` is the one place a gesture picks the side; a removal that asks for the next block itself lands Backspace below',
		hits: ['caret: (committed) => caretWhereRangeResumes(committed, path),'],
		misses: ["import { caretWhereRangeResumes } from './range-delete-chrome';"]
	},
	{
		id: 'G4.84 a StoredAs is made only from the tree, in one place',
		matches: /\bas\s+StoredAs\b/,
		allowed: {
			'src/lib/tree-operations/stored-as.ts':
				'derives how a leaf position stores bytes from the tree it sits in'
		},
		reason:
			'a rewrite that describes its own position reads a cell as a block or forgets its container; take one from `storedAsAt` or `storedAsIn`',
		hits: ['return { reading, surface: "block", stored, readSlot } as StoredAs;'],
		misses: ["import type { StoredAs } from '../schema/stored-as';", 'const s: StoredAsLike = x;']
	},
	{
		id: 'G4.85 a removing live rewrite reads its candidate through readBack, never a parse of its own',
		population: holdsLiveRewrites,
		matches: /(?<![\w.])(?:readBlocks|parse|parseTaskItemBody)\s*\(/,
		allowed: {
			[`${TEXT_BLOCK_DIR}live-split-rebalance.ts`]:
				'`soleProseBlock`, the split’s own candidate read, moves onto `readBack` in T19 slice 3'
		},
		reaches: [
			`${TEXT_BLOCK_DIR}live-join-seam.ts`,
			`${TEXT_BLOCK_DIR}construct-edge-delete.ts`,
			`${TEXT_BLOCK_DIR}live-selection-edit.ts`,
			`${LIVE_EDIT_DIR}read-back.ts`
		],
		reason:
			'a candidate read as a top-level fragment forgets its container: a list item reads it behind its marker, a cell as text; take `readBack(bytes, store)`',
		hits: [at(LIVE_EDIT_PROBE, "const blocks = readBlocks(raw, { grammar, scope: 'fragment' });")],
		misses: [
			at(LIVE_EDIT_PROBE, 'const read = readBack(raw, store);'),
			at(LIVE_EDIT_PROBE, 'const inlines = readInline(raw, 0, n);')
		]
	},
	{
		id: 'G4.86 a list item’s marker is read where the list is built, drawn or dumped',
		matches: LIST_MARKER_READ,
		allowed: {
			'src/lib/schema/container-rebuilders.ts': 'writes the marker back in front of the item',
			'src/lib/tree-operations/list/ordered-markers.ts': 'renumbers an ordered list',
			'src/lib/editor-actions/list-context.ts': 'gives a new item the next marker',
			'src/lib/components/blocks/list/ListItemBlock.svelte': 'draws a bullet or a number',
			'src/lib/components/blocks/list/task-checkbox.ts': 'paints the marker before the checkbox',
			'src/lib/debug/dump-tree.ts': 'prints it in the tree dump'
		},
		reason:
			'a rewrite that reads the marker to check its own bytes carries a second answer to where they are stored; read them back through `storedAsAt`',
		hits: [
			'return (blocks[0] as { marker?: string }).marker === prefix;',
			"const m = metadataOf(item, 'listItem').marker;",
			'const prefix = meta?.marker ?? "- ";'
		],
		misses: ['const run = fence.marker.repeat(3);', 'mark.markerBytes']
	}
];

// ── G4.89, G4.90 one in-leaf range replace ─────────────────────────────────

/** The directories holding live editing paths; a fenced code body has no inline constructs. */
const SPLICE_PATHS = [
	'src/lib/components/',
	'src/lib/selection/',
	'src/lib/editor-actions/',
	'src/lib/tree-operations/',
	'src/lib/core/inline/',
	'src/lib/inline-menu/'
];

const SPLICE_PROBE = 'src/lib/components/blocks/text/probe.ts';

/** One variable's bytes before a cut joined to the same variable's bytes after it. */
const SAME_SOURCE_SPLICE = /\b([\w.]+)\.slice\(\s*0\s*,[^;]{0,200}?\+[^;]{0,200}?\b\1\.slice\(/s;

/** A file naming the paste's selection that cuts nothing through the in-leaf range replace. */
const namesPasteRangeWithoutReplace = (file: SourceFile): boolean =>
	/(?<![\w.'"])preDelete\b/.test(file.code) && !/(?<![\w.])replaceRangeInLeaf\s*\(/.test(file.code);

const LEAF_RANGE_RULES: FileRule[] = [
	{
		id: 'G4.89 only the in-leaf range replace, the split cuts and the endpoint snap snap an offset',
		matches: /(?<![\w.])snapToScalarBoundary\s*\(/,
		allowed: {
			'src/lib/core/lines.ts': 'defines the snap',
			'src/lib/tree-operations/leaf-range.ts': 'every in-leaf range replace, typed text or none',
			'src/lib/tree-operations/node-ops.ts':
				"`cutPastLineEnding`, the split's cut, which keeps a pair on one side of two blocks",
			'src/lib/tree-operations/structural-suffix.ts':
				"`cutKeepingStructure`, a split's and a structural paste's two halves",
			'src/lib/selection/char-endpoint-snap.ts': 'a selection endpoint, which cuts nothing'
		},
		reason:
			'a cut of one leaf goes through `replaceRangeInLeaf`, which snaps both ends, cuts back to the painted text and cleans the join with the typed text in it; a cut that snaps on its own has none of that',
		hits: ['const start = snapToScalarBoundary(display, range.start);'],
		misses: [
			"import { snapToScalarBoundary } from '../core/lines';",
			'// snapToScalarBoundary(raw, 3)'
		]
	},
	{
		id: 'G4.89 the joins of two leaves are the declared ones',
		matches: /(?<![\w.])joinLeaves\s*\(/,
		allowed: {
			'src/lib/tree-operations/leaf-range.ts': 'defines it',
			'src/lib/tree-operations/node-ops.ts': "`joinIntoLeaf`, the merge's one join into a leaf"
		},
		reason:
			'a join of two leaves runs the tail kind’s write rule and the live cleanup once, here; declare a new caller with what it joins',
		hits: ["const { raw, seam } = joinLeaves(head, tail, '', store);"],
		misses: ["import { joinLeaves } from './leaf-range';"]
	},
	{
		id: 'G4.89 a leaf’s own bytes are spliced by the in-leaf range replace, or say why not',
		population: (file) =>
			under(...SPLICE_PATHS)(file) && !file.relPath.startsWith('src/lib/components/blocks/code/'),
		matches: SAME_SOURCE_SPLICE,
		allowed: {
			'src/lib/tree-operations/leaf-range.ts': 'the in-leaf range replace itself',
			'src/lib/components/blocks/text/live-join-seam.ts':
				'the join cleanup, which the range replace calls',
			'src/lib/tree-operations/structural-suffix.ts': "a split's two halves, which remove nothing",
			'src/lib/components/blocks/text/construct-edge-delete.ts':
				'the edge delete, which reads its own candidate back where it is stored',
			'src/lib/components/blocks/text/text-keydown.ts':
				'a hard break or a tab inserted, which deletes nothing',
			'src/lib/components/blocks/text/pending-break-keys.ts':
				'a key typed on the line a pending break opened, which deletes nothing',
			'src/lib/components/blocks/text/edge-seat.ts':
				'a typed byte probed or placed at a caret position, which deletes nothing',
			'src/lib/components/blocks/text/pending-mark-insert.ts':
				'a typed run inserted wrapped in the pending marks, which deletes nothing',
			'src/lib/components/blocks/text/delimiter-autopair.ts':
				'a delimiter inserted with its pair, or the empty pair it wrote taken back whole',
			'src/lib/components/blocks/text/auto-pair-record.ts':
				'remembers a pair the auto-pair wrote and writes nothing',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'a `<br>` inserted at the caret, which deletes nothing',
			'src/lib/components/blocks/editable-leaf.ts':
				'a shown source’s own text, where every marker is on screen',
			'src/lib/components/image/image-widget-editing.ts':
				'an image replaced by its own edited bytes, one whole construct for another',
			'src/lib/core/inline/format-toggle.ts':
				'the format toggle writes delimiters and checks its candidate against the screen',
			'src/lib/core/inline/link-source-bytes.ts':
				'the link writer rewrites one whole link and checks its candidate against the screen',
			'src/lib/editor-actions/inline-range-commit.ts':
				'a popover or menu insert over the range it replaces, nothing cut from under a delimiter it keeps',
			'src/lib/inline-menu/inline-menu-session.ts': 'compares two texts and writes nothing',
			'src/lib/selection/selection-drop.ts':
				'a drop inserts at the drop point; its cut goes through the range replace',
			'src/lib/selection/range-delete.ts':
				'the range delete’s own join, a known gap until it calls `joinLeaves` (T18 slice 5)',
			'src/lib/selection/cross-block/range-replace.ts':
				'a key typed over a range lands after its removal, a known gap until the text rides into the join (T18 slice 5)'
		},
		reason:
			'a splice of a leaf’s own bytes that cuts a range can strand the delimiter runs around it; call `replaceRangeInLeaf`, or declare why the splice cuts nothing',
		hits: [
			at(SPLICE_PROBE, 'const next = node.raw.slice(0, w.start) + node.raw.slice(w.end);'),
			at(SPLICE_PROBE, 'const out = raw.slice(0, a) + text + raw.slice(b);')
		],
		misses: [
			at(SPLICE_PROBE, 'const out = head.slice(0, a) + tail.slice(b);'),
			at(SPLICE_PROBE, 'const edit = replaceRangeInLeaf(node, range, text, store);'),
			at('src/lib/components/blocks/code/probe.ts', 'const out = raw.slice(0, a) + raw.slice(b);')
		]
	},
	{
		id: 'G4.90 a paste’s selection is cut through the in-leaf range replace',
		matches: namesPasteRangeWithoutReplace,
		allowed: {
			'src/lib/tree-operations/paste-surfaces.ts': 'declares the parameter and cuts nothing',
			'src/lib/components/blocks/code/CodeBlock.svelte':
				'makes the range from its selection and hands it to the dispatch',
			'src/lib/components/blocks/code/code-paste-surface.ts':
				'the one literal splice: a fence body has no inline constructs to clean'
		},
		reason:
			'a paste writes what typing writes over the same selection, so its cut is `replaceRangeInLeaf` with the pasted text; a cut of its own strands the runs typing keeps',
		hits: [
			'return display.slice(0, preDelete.start) + text + display.slice(preDelete.end);',
			'const cut = cutRange(node, preDelete, store);'
		],
		misses: [
			'const edit = replaceRangeInLeaf(node, preDelete, text, store);',
			'// preDelete is the range the paste cuts first'
		]
	}
];

// ── G4.87 one writer of the scroll position ─────────────────────────────────

/** A scroll write. `scroll`/`scrollTo` count only with a position argument, so the published
 *  `rects.scrollTo(path)` isn't one. */
const SCROLL_WRITE_RE = new RegExp(
	[
		/\.scrollTop\s*(?:=(?!=)|\+=|-=|\+\+|--)/,
		/(?:\+\+|--)\s*[\w.]+\.scrollTop\b/,
		/\.scroll(?:To)?\s*\(\s*[{\d-]/,
		/\bwindow\.scroll(?:To)?\s*\(/,
		/\b(?:scrollBy|setScrollTop|scrollIntoView|createScrollport|withRelativeScroll)\s*\(/
	]
		.map((part) => part.source)
		.join('|')
);

const SCROLL_WRITERS: ManifestRule[] = [
	{
		id: 'G4.87 only the scroll owner writes the editor’s scroll position',
		matches: SCROLL_WRITE_RE,
		declared: {
			'src/lib/cursor/scroll-owner.ts':
				'the one writer, which asks who owns the position before each write',
			'src/lib/cursor/scrollport.ts':
				'the scroll container’s write methods, which only the owner opens',
			'src/lib/selection/autoscroll.ts':
				'a drag’s own cadence, driven by the pointer; its pointerdown already dropped any hold',
			'src/lib/components/menu/InlineMenuHost.svelte':
				'the active row of a listbox, inside the menu’s own scroller',
			'src/lib/components/blocks/code/CodeBlockRail.svelte':
				'the active row of a listbox, inside the rail’s own scroller'
		},
		reason:
			'a scroll write outside the scroll owner skips its check of who owns the position: call a method on `EditorServices.scrollOwner`, or declare a scroller of its own here with why',
		reaches: ['src/lib/cursor/scroll-owner.ts'],
		hits: [
			'el.scrollTop = 40;',
			'scroller.scrollTop += dy;',
			'port.scrollBy(delta);',
			'port.setScrollTop(top);',
			"blockEl?.scrollIntoView({ block: 'nearest' });",
			'const port = createScrollport(host);',
			'withRelativeScroll(base)',
			'el.scrollTo({ top: 40 });',
			'el.scrollTo(0, 120);',
			'window.scrollTo(x, y);',
			'window.scroll(0, top);',
			'el.scroll({ top });',
			'scroller.scrollTop++;',
			'--el.scrollTop;'
		],
		misses: [
			'// Scrollable through script: `element.scrollTop = n` moves it.\nconst a = 1;',
			'const top = el.scrollTop;\nif (el.scrollTop === 0) {}',
			'scrollOwner.scrollToMount(top);\nvoid rects.scrollTo([4]);\nawait rects.scrollTo(p, opts);',
			'return placement.scroll();\nconst landed = await deps.scroll.place(p, o).scroll();'
		]
	},
	{
		id: 'G4.87 a list asks for a mount scroll by path, from its descent alone',
		matches: /(?<![\w$])scrollToMount\s*\(/,
		declared: {
			'src/lib/cursor/scroll-owner.ts': 'the owner, which works out where from the list tree',
			'src/lib/reactivity/list-windowing.svelte.ts':
				'`revealChild`, the descent’s one scroll, naming the block and never a position'
		},
		reason:
			'a list that scrolls outside its descent corrects behind the measure round’s back: write heights and let the round keep the page still, or declare why here',
		reaches: ['src/lib/reactivity/list-windowing.svelte.ts'],
		hits: ['deps.scroll.scrollToMount([...path, index]);', 'owner.scrollToMount (path)'],
		misses: [
			'scrollToMount: scrollOwner.scrollToMount,',
			'// scrollToMount(path) mounts it.\nconst a = 1;'
		]
	}
];

// ── G4.91 a focus call scrolls nothing unless declared ──────────────────────

/** A DOM focus call that may scroll: no arguments, or options without `preventScroll`. A block
 *  component's `focus(offset)` takes a number and isn't one. */
const BARE_FOCUS_RE = /\.focus\s*(?:\?\.)?\s*\(\s*(?:\)|\{(?![^}]*preventScroll))/;

const BARE_FOCUSES: ManifestRule[] = [
	{
		id: 'G4.91 a focus call that may scroll is declared',
		matches: BARE_FOCUS_RE,
		declared: {
			'src/lib/components/blocks/text/widget-interaction.ts':
				'a click that reveals a widget’s source focuses the surface under the pointer, already on screen',
			'src/lib/cursor/reveal-source.ts':
				'the revealed source takes focus where the click that revealed it landed',
			'src/lib/components/GapCaret.svelte':
				'an arrow move arriving on a gap caret keeps the browser’s own scroll to it',
			'src/lib/selection/keyboard-extend.ts':
				'a native range re-made in a block the keyboard is already on',
			'src/lib/plugins/mermaid/MermaidBlock.svelte':
				'the diagram’s own surface takes focus back after a redraw or an edit, and the focus view its overlay',
			'src/lib/components/blocks/code/CodeBlockRail.svelte':
				'the rail’s menu button takes focus back as its popout closes',
			'src/lib/components/blocks/table/TableActionMenu.svelte':
				'the menu’s own rows and stops, inside its popout',
			'src/lib/components/image/ImageProperties.svelte': 'the popover’s own field',
			'src/lib/components/link-card/LinkCard.svelte':
				'the card’s own field and buttons, inside its popout',
			'src/lib/components/SearchBar.svelte': 'the find field, in the bar’s own box'
		},
		reason:
			'a focus call without `preventScroll` scrolls the editor behind the scroll owner’s back: pass `{ preventScroll: true }` and let the route that moved the caret ask the owner, or declare here why this one may scroll',
		reaches: ['src/lib/selection/native-bridge.ts'],
		hits: [
			'el.focus();',
			'blockEl?.focus();',
			'el.focus?.();',
			'el.focus({ focusVisible: true });'
		],
		misses: [
			'el.focus({ preventScroll: true });',
			'el.focus({ focusVisible: true, preventScroll: true });',
			'component.focus(offset);\nref.focus(CURSOR_START);',
			'// `el.focus()` scrolls by default.\nconst a = 1;'
		]
	}
];

// ── G4.93 one pick of the block a list keeps still ──────────────────────────

/** Every call that corrects, picks a held block or holds nothing, keyed by path, function and
 *  kind, so a call moved elsewhere fails. `<module>` is a function with a bracketed return type. */
const CORRECTIONS: Record<string, { calls: number; reason: string }> = {
	'src/lib/reactivity/list-tree.ts :: descend :: heldBlock': {
		calls: 1,
		reason: 'the one pick of the block a measure round keeps still, level by level'
	},
	'src/lib/reactivity/list-tree.ts :: movedSince :: held move': {
		calls: 1,
		reason: 'the one distance the round corrects by, read through the same walk as `resolve`'
	},
	'src/lib/components/editor-root-geometry.ts :: <module> :: compensate': {
		calls: 1,
		reason:
			'the header slot sits above every list, so no list’s pick applies: it keeps the document still unless the page is at its top'
	}
};

interface CallKind {
	kind: string;
	callee: string;
	counts: (args: string) => boolean;
}

const CORRECTION_KINDS: CallKind[] = [
	{ kind: 'compensate', callee: 'compensate', counts: () => true },
	{ kind: 'heldBlock', callee: 'heldBlock', counts: () => true },
	{ kind: 'held move', callee: 'heldDelta', counts: () => true }
];

/** Each `path :: function :: kind` in `file` with its count; a definition or signature isn't a call. */
function callSites(file: SourceFile, kinds: CallKind[]): Map<string, number> {
	const found = new Map<string, number>();
	const { code } = file;
	for (const { kind, callee, counts } of kinds) {
		for (const match of code.matchAll(new RegExp(`(?<![\\w$])${callee}\\s*\\(`, 'g'))) {
			const open = match.index + match[0].length;
			const args = balancedCall(code, open);
			if (args === null) continue;
			const defines = /^\s*\{/.test(code.slice(open + args.length + 1));
			const typed = callArguments(args).some((arg) => /^[\w$]+\??:/.test(arg));
			if (defines || typed || !counts(args)) continue;
			const where = enclosingFunction(code, match.index, fileClasses(file));
			const key = `${file.relPath} :: ${where} :: ${kind}`;
			found.set(key, (found.get(key) ?? 0) + 1);
		}
	}
	return found;
}

const HELD_BRANDS: FileRule = {
	id: 'G4.93 only `hold-across.ts` makes a held block or the distance it moved',
	matches: /\bas\s+(?:HeldBlock|HeldDelta)\b/,
	allowed: {
		'src/lib/reactivity/hold-across.ts':
			'`heldBlock` and `heldDelta`, the one pick and the one distance'
	},
	reason:
		'a cast to a held block or a held distance picks the block a list keeps still somewhere other than `heldBlock`: call `heldBlock` and `heldDelta` instead',
	reaches: ['src/lib/reactivity/hold-across.ts'],
	hits: ['return 0 as HeldDelta;', "const held = { id: 'b3', index: 3 } as HeldBlock;"],
	misses: ['const held: HeldBlock | null = heldBlock(table, top, focused);']
};

function describeCorrections(sources: SourceFile[]): void {
	describe('G4.93 every height correction is declared, and a list’s holds what `heldBlock` picks', () => {
		it('the calls are exactly the declared ones', () => {
			const found = Object.fromEntries(
				sources.flatMap((file) => [...callSites(file, CORRECTION_KINDS)])
			);
			const declared = Object.fromEntries(
				Object.entries(CORRECTIONS).map(([site, { calls }]) => [site, calls])
			);
			expect(
				found,
				'a new height correction picks its own held block: let the scroll owner’s measure round hold one block for the whole document, or declare the call here with why'
			).toEqual(declared);
		});

		it('the census counts calls where they sit and skips a definition or a signature', () => {
			const sites = (code: string) =>
				Object.fromEntries(callSites(probeFile(code), CORRECTION_KINDS));
			expect(sites('function a() {\n\troot.compensate(w, () => 0);\n}')).toEqual({
				'probe.ts :: a :: compensate': 1
			});
			expect(sites('function b() {\n\theldDelta(0, walk(heldBlock(t, 0, i)));\n}')).toEqual({
				'probe.ts :: b :: heldBlock': 1,
				'probe.ts :: b :: held move': 1
			});
			expect(sites('owner ? owner.compensate(mutate, held) : mutate();')).toEqual({
				'probe.ts :: <module> :: compensate': 1
			});
			expect(sites('compensate(mutate, held) {\n\tcompensations++;\n}')).toEqual({});
			expect(sites('compensate(mutate: () => void, held: Held): void;')).toEqual({});
			expect(sites('// compensate(mutate, held);\nconst a = 1;')).toEqual({});
		});
	});
}

// ── G4.97 one way a child's height reaches its list's table ─────────────────

/** Every write of a measured height and every registration with a list, keyed like G4.93. */
const MEASURE_WRITES: Record<string, { calls: number; reason: string }> = {
	'src/lib/reactivity/list-windowing.svelte.ts :: applyMeasured :: table write': {
		calls: 1,
		reason:
			'the one write of a child’s height into its list’s table, only while that index still holds that id'
	},
	'src/lib/reactivity/list-windowing.svelte.ts :: applyMeasured :: cache write': {
		calls: 1,
		reason: 'records the height under the id the child passed'
	},
	'src/lib/reactivity/list-windowing.svelte.ts :: applyHeight :: applyMeasured': {
		calls: 1,
		reason: 'the batched pass applies each registered child through the one write'
	},
	'src/lib/reactivity/use-container-windowing.svelte.ts :: register :: registration': {
		calls: 1,
		reason: 'the channel every list provides, which checks the child is its own'
	}
};

const MEASURE_KINDS: CallKind[] = [
	{ kind: 'table write', callee: 'setHeight', counts: () => true },
	{ kind: 'cache write', callee: 'recordMeasured', counts: () => true },
	{ kind: 'applyMeasured', callee: 'applyMeasured', counts: () => true },
	{ kind: 'registration', callee: 'registerChild', counts: () => true }
];

/** The channel is read only by the hook that owns the three triggers. */
const MEASURE_CHANNEL: ManifestRule = {
	id: 'G4.97 only `useMeasuredChild` reads a list’s measure channel',
	matches: /(?<![\w$])CHILD_MEASURE_KEY\b/,
	declared: {
		'src/lib/editor-keys.ts': 'defines the key',
		'src/lib/reactivity/use-container-windowing.svelte.ts': 'every list provides the channel',
		'src/lib/reactivity/use-measured-child.svelte.ts':
			'the one reader, which registers at mount, re-measures after an edit and on a resize'
	},
	reason:
		'a child that reads the channel itself wires its own triggers, and a hand-wired copy misses one: call `useMeasuredChild`',
	hits: ['const channel = getContext(CHILD_MEASURE_KEY);'],
	misses: [
		'const channel = getContext(CHILD_MEASURE_KEYS);',
		'// `CHILD_MEASURE_KEY` is the channel.\nconst a = 1;'
	]
};

function describeMeasureWrites(sources: SourceFile[]): void {
	describe('G4.97 a child’s height reaches its list’s table through one write', () => {
		it('the writes and registrations are exactly the declared ones', () => {
			const found = Object.fromEntries(
				sources.flatMap((file) => [...callSites(file, MEASURE_KINDS)])
			);
			const declared = Object.fromEntries(
				Object.entries(MEASURE_WRITES).map(([site, { calls }]) => [site, calls])
			);
			expect(
				found,
				'a list’s height table is written or registered with outside its one write: measure a child through `useMeasuredChild`, or declare the call here with why'
			).toEqual(declared);
		});
	});
}

// ── G4.98 one place throws measured heights away ────────────────────────────

const LAYOUT_HOME = 'src/lib/reactivity/layout-state.svelte.ts';

const HEIGHT_LIFETIME: ManifestRule[] = [
	{
		// Layout state hands out the estimator without its drop, so the type holds the rest; this
		// catches a second estimator, or a cast back to the one with the drop.
		id: 'G4.98 only layout state builds the height estimator that can drop',
		matches: /(?<!\bfunction\s+)(?<![\w$])createHeightOracle\s*\(|\bas\s+MeasuredHeightOracle\b/,
		declared: {
			[LAYOUT_HOME]: 'the one estimator, whose drop only layout state can reach'
		},
		reason:
			'a height estimator built or cast outside layout state can drop measured heights without the width version the change needs: read `LayoutState.heightOracle`, and call `forgetMeasuredHeights` or `rebuildForNewGeometry`',
		reaches: [LAYOUT_HOME],
		hits: [
			'const oracle = createHeightOracle({ lineHeight: 24 });',
			'createHeightOracle (opts)',
			'const full = heightOracle as MeasuredHeightOracle;'
		],
		misses: [
			'export function createHeightOracle(opts: HeightOracleOptions): MeasuredHeightOracle {',
			"import { createHeightOracle } from '../cursor/height-oracle';",
			'const layout = createLayoutState();',
			'// createHeightOracle(opts) builds one.\nconst a = 1;'
		]
	},
	{
		id: 'G4.98 only layout state moves the width version',
		matches:
			/(?<![\w$.])(?<!\b(?:const|let|var)\s+)widthVersion\s*(?:\+\+|--|[-+]?=(?!=))|(?:\+\+|--)\s*widthVersion\b/,
		declared: {
			[LAYOUT_HOME]: 'the width version, moved by a width or type-scale change as it drops heights'
		},
		reason:
			'a second width-version writer rebuilds every list without dropping the measured heights, or the other way round: call `rebuildForNewGeometry` on layout state',
		reaches: [LAYOUT_HOME],
		hits: ['widthVersion++;', 'widthVersion += 1;', '++widthVersion;', 'widthVersion = next;'],
		misses: [
			'const widthVersion = deps.getWidthVersion();',
			'widthVersion: layout.widthVersion,',
			'if (next.widthVersion === measuredWidth) return;',
			'getWidthVersion: () => widthVersion,',
			'// widthVersion++ rebuilds.\nconst a = 1;'
		]
	}
];

// ── G4.87 inside the owner, every write closes the round first ──────────────

/** The owner's raw writes of its port, keyed like G4.93: `writeScroll`, which closes an open
 *  round before it writes, and the round's own correction beneath it. */
const OWNER_RAW_WRITES: Record<string, { calls: number; reason: string }> = {
	'src/lib/cursor/scroll-owner.ts :: writeScroll :: absolute': {
		calls: 1,
		reason: 'every owner write but the round’s, once the round is closed'
	},
	'src/lib/cursor/scroll-owner.ts :: writeScroll :: relative': {
		calls: 1,
		reason: 'the same write, by a distance'
	},
	'src/lib/cursor/scroll-owner.ts :: writeScroll :: into view': {
		calls: 1,
		reason: 'a placement’s scroll, once the round is closed'
	},
	'src/lib/cursor/scroll-owner.ts :: closeRound :: absolute': {
		calls: 1,
		reason: 'a held placement put back as the round closes'
	},
	'src/lib/cursor/scroll-owner.ts :: closeRound :: relative': {
		calls: 1,
		reason: 'the round’s own correction'
	}
};

const RAW_WRITE_KINDS: CallKind[] = [
	{ kind: 'absolute', callee: 'setScrollTop', counts: () => true },
	{ kind: 'relative', callee: 'scrollBy', counts: () => true },
	{ kind: 'into view', callee: 'scrollIntoView', counts: () => true }
];

function describeOwnerWrites(sources: SourceFile[]): void {
	describe('G4.87 every owner write closes an open round before it writes', () => {
		it('only `writeScroll` and the round’s close write the port', () => {
			const found = Object.fromEntries(
				sources
					.filter((file) => file.relPath === 'src/lib/cursor/scroll-owner.ts')
					.flatMap((file) => [...callSites(file, RAW_WRITE_KINDS)])
			);
			const declared = Object.fromEntries(
				Object.entries(OWNER_RAW_WRITES).map(([site, { calls }]) => [site, calls])
			);
			expect(
				found,
				'an owner write outside `writeScroll` can land under an open round: go through `writeScroll`, or declare it here with why'
			).toEqual(declared);
		});
	});
}

// ── G4.94 the editor's own selection has one store and three writers ─────────

const SELECTION_WRITERS: ManifestRule[] = [
	{
		id: 'G4.94 a gap caret or a widget is selected only through the caret doors',
		matches: /\.(?:setGapCaret|selectWidget)\s*\(/,
		declared: {
			'src/lib/selection/caret-doors.ts':
				'`placeGapCaret` and `selectWidgetWhole`, which end the browser’s own range in the same batch'
		},
		reason:
			'a gap caret or a widget selected outside `selection/caret-doors.ts` can leave a browser caret live beside it: call `placeGapCaret` or `selectWidgetWhole`',
		hits: [
			'selection.setGapCaret(pos);',
			'deps.selection.selectWidget({ paragraphPath, sourceStart, preSelectOffset });',
			'state.setGapCaret (pos)'
		],
		misses: [
			'placeGapCaret(selection, pos);\nselectWidgetWhole(selection, target);',
			'setGapCaret(pos: GapCaretPosition): void {\nselectWidget(target: WidgetTarget): void {',
			'// `selection.setGapCaret(pos)` skips the door.\nconst a = 1;',
			'view.select(target);\nselection.clearGapCaret();'
		]
	},
	{
		id: 'G4.94 a widget selected whole is held only by the selection state',
		matches: /\$state\s*<[^>]*\bWidgetTarget\b|\bWidgetTarget\b[^=;\n]*=\s*\$state\s*\(/,
		declared: {
			'src/lib/selection/selection-state.svelte.ts':
				'the one store, whose private writer ends the range and the gap caret as it takes the widget'
		},
		reason:
			'a second place holding a selected widget has to be kept apart from the range and the gap caret by hand, and every reader has to be taught it: read and write `SelectionState.widget`',
		hits: [
			'let selected = $state<WidgetTarget | null>(null);',
			'#widget: WidgetTarget | null = $state(null);',
			'let held: WidgetTarget = $state(initial);'
		],
		misses: [
			'const target: WidgetTarget = { paragraphPath, sourceStart, preSelectOffset };',
			'let count = $state(0);\nconst widget: WidgetTarget | null = selection.widget;',
			'// A `$state<WidgetTarget>` cell here would be a second store.\nconst a = 1;'
		]
	}
];

// ── G4.101 what a typed write asks, it asks through the surface write ────────

const ROGUE_WRITER = 'src/lib/components/blocks/x/rogue-writer.ts';

const TYPED_WRITE_ASKS: ManifestRule[] = [
	{
		id: 'G4.101 only the surface write names a typed kind change or completes a typed line',
		population: under('src/lib/components/', 'src/lib/selection/'),
		matches: /\.(?:afterTypedWrite|completeLineOnType)\s*\(/,
		declared: {
			'src/lib/components/blocks/surface-write.ts':
				'`writeText`, which asks both for a `typed` write and for no other'
		},
		reason:
			'a surface route that asks the kind cue or the on-type completer itself gets them for a command, a paste or a repair too, or misses them for a key: write through `writeText` with the typed intent',
		hits: [
			at(ROGUE_WRITER, 'void kindCue.afterTypedWrite(write, myPath, before);'),
			at(ROGUE_WRITER, 'await deps.blockEdit.completeLineOnType(index, caret);')
		],
		misses: [
			at(ROGUE_WRITER, 'afterTypedWrite(write, path, before) {}'),
			at(ROGUE_WRITER, '// `kindCue.afterTypedWrite(write)` is the surface write’s.\nconst a = 1;'),
			at('src/lib/editor-actions/x.ts', 'await blockEdit.completeLineOnType(index, caret);')
		]
	}
];

// ── G4.108 one replace for every destructive gesture over a range ──────────

const ROGUE_RANGE_ROUTE = 'src/lib/selection/cross-block/rogue.ts';
const RANGE_REPLACE_HOME = 'src/lib/selection/cross-block/range-replace.ts';

const RANGE_REPLACE: ManifestRule[] = [
	{
		id: 'G4.108 only the range replace removes a live range',
		population: notUnder('src/lib/selection/range-delete'),
		matches: /(?<![\w.])(?:rangeDelete|removeHeldWhole|commitGridLineDelete)\s*\(/,
		declared: {
			[RANGE_REPLACE_HOME]:
				'picks the removal from what the range covers, for every destructive gesture over it'
		},
		reason:
			'a gesture that removes a range itself skips what every other one gets: the removal picked by what the range covers, one undo entry and one caret landing; call `replaceRange` with the gesture’s insertion',
		hits: [
			at(ROGUE_RANGE_ROUTE, 'const removed = rangeDelete(doc, coverage, sharing, reading, "cut");'),
			at(ROGUE_RANGE_ROUTE, 'remove: (sharing) => removeHeldWhole(doc, coverage, sharing, r, g),'),
			at(ROGUE_RANGE_ROUTE, 'const caret = await commitGridLineDelete(ctx, grid);')
		],
		misses: [
			at(ROGUE_RANGE_ROUTE, "import { rangeDelete, removeHeldWhole } from '../range-delete';"),
			at(ROGUE_RANGE_ROUTE, 'return tableAwareRangeDelete(doc, coverage, sharing, reading);')
		]
	},
	{
		id: 'G4.108 a gesture over a range opens its undo entry in the range replace or indent only',
		population: under('src/lib/selection/cross-block/'),
		matches: /\.undoStep\s*\(/,
		declared: {
			[RANGE_REPLACE_HOME]: 'opens the one undo entry a destructive gesture over a range writes',
			'src/lib/selection/cross-block/range-indent.ts':
				'opens the one undo entry Tab or Shift+Tab over a range writes, which removes nothing'
		},
		reason:
			'a range gesture that opens its own undo entry writes its removal and its insertion around the range replace, so one Ctrl+Z no longer takes back the gesture: call `replaceRange`',
		hits: [at(ROGUE_RANGE_ROUTE, 'await ctx.controller.undoStep(seed, async () => {});')],
		misses: [
			at(ROGUE_RANGE_ROUTE, 'undoStep(seed: CommitSnapshotArg, run: () => Promise<unknown>);')
		]
	}
];

// ── G4.112 Tab over a range indents through one route ──────────────────────

const ROGUE_INDENT_ROUTE = 'src/lib/components/blocks/rogue.ts';
const ITEM_MOVES_HOME = 'src/lib/tree-operations/list/item-moves.ts';

const RANGE_INDENT: ManifestRule[] = [
	{
		id: 'G4.112 a list item nests or lifts through the shared item moves only',
		matches: /(?<![\w.'])(?:nestListItem|liftNestedItem)\s*\(/,
		declared: {
			[ITEM_MOVES_HOME]: 'defines the two moves',
			'src/lib/editor-actions/list-context.ts': 'one item, from a caret’s own Tab or Shift+Tab',
			'src/lib/selection/cross-block/range-indent.ts': 'every item a range touches, from its Tab'
		},
		reason:
			'a route that moves list items itself splits what Tab means: a range’s items would nest one way and a caret’s another; call `nestListItem` or `liftNestedItem`',
		hits: [
			at(ROGUE_INDENT_ROUTE, 'await nestListItem(commits, list, 1);'),
			at(ROGUE_INDENT_ROUTE, 'void liftNestedItem(commits, outer, 0, nested, 1, grammar);')
		],
		misses: [
			at(ROGUE_INDENT_ROUTE, 'await listContext.promoteNestedItem(0, nested, 1);'),
			at(ROGUE_INDENT_ROUTE, "import { nestListItem } from './item-moves';")
		]
	},
	{
		id: 'G4.112 a key resolves to a command at the declared dispatch points only',
		population: notUnder('src/lib/schema/'),
		matches: /(?<![\w.])(?:dispatchKindCommand|dispatchKeyCommand|commandForKey)\s*\(/,
		declared: {
			'src/lib/editor-actions/container-block-component.ts':
				'the container dispatch, which leaves a key a live range owns to the range, whose handler claims it only after an await',
			'src/lib/components/blocks/surface-wiring.svelte.ts':
				'a leaf’s own chords, which the leaf runs once the range’s handler has passed on the key',
			'src/lib/selection/cross-block/keydown.ts':
				'the range’s own handler: what the caret memory notes, whether a key indents, and a format chord over the range',
			'src/lib/selection/cross-block/range-indent.ts':
				'what each block the range covers says an indent key means',
			'src/lib/selection/cross-block/range-replace.ts':
				'a command key, run at the caret the range’s removal leaves',
			'src/lib/editor-actions/plugin/container.ts':
				'reads what a key means for the caret memory, and never runs it',
			'src/lib/components/link-card/LinkCardHost.svelte':
				'asks only whether the key is the one that opens the link card'
		},
		reason:
			'a container that resolves a chord itself runs Tab on its own item while the range below indents every item: call `dispatchContainerChord`',
		hits: [
			at(ROGUE_INDENT_ROUTE, 'dispatchKindCommand(chord, target, commands);'),
			at(ROGUE_INDENT_ROUTE, 'if (dispatchKeyCommand(chord, target, commands)) return;'),
			at(ROGUE_INDENT_ROUTE, "if (commandForKey(e, kind, commands) === 'list.indent') indent();")
		],
		misses: [at(ROGUE_INDENT_ROUTE, 'dispatchContainerChord(e, target, commands, range);')]
	},
	{
		id: 'G4.112 a command key over a range is pressed from the keydown handler only',
		population: under('src/lib/'),
		matches: /\{\s*kind:\s*'command',/,
		declared: {
			'src/lib/selection/cross-block/keydown.ts':
				'Enter and Mod+digit, whose candidate test leaves Tab to the range indent'
		},
		reason:
			'a range replace with a command insertion removes the range before the key runs, which Tab must never do: Tab over a range goes to `indentRange`',
		hits: [at(ROGUE_INDENT_ROUTE, "await replaceRange(ctx, { kind: 'command', chord: 'Tab' });")],
		misses: [at(ROGUE_INDENT_ROUTE, "| { kind: 'command'; chord: string };")]
	}
];

// ── A caret goes down through the caret landing ─────────────────────────────

const REF_FOCUS: FileRule = {
	id: 'a caret goes down through the caret landing, never a block ref’s own focus',
	matches:
		/(?:\b(?:refAt|cellRefAt|rowRefAt)\([^)]*\)|(?:innerBlockRefs|blockRefs)\[[^\]]*\])\s*\??\.\s*(?:focus|focusByPath|parkCaret)\s*(?:\?\.\s*)?\(/,
	allowed: {
		'src/lib/components/blocks/table/TableRowBlock.svelte':
			'the row’s own `focus` and `parkCaret` handing the caret to its edge cell, which the landing calls',
		'src/lib/components/blocks/table/TableBlock.svelte':
			'the table’s own `focus`, `parkCaret` and `focusByPath` handing the caret to a cell, which the landing calls; a cell’s Tab or arrow move to its neighbour shares `focusCell`'
	},
	reason:
		'a ref focused by hand skips what the landing does: the mount, the check that no undo or swap came in between, the scroll; hand the commit a `landing`, or call the landing',
	hits: [
		'blockRefs[i]?.focus(offset);',
		'refAt(list, i)?.parkCaret(0);',
		'state.innerBlockRefs[colIdx]?.focusByPath(path, at);',
		// The optional members of `BlockComponent` type-check only as optional calls.
		'blockRefs[0]?.parkCaret?.(0);',
		'state.innerBlockRefs[i]?.focusByPath?.(rest, at);',
		'cellRefAt(rowIdx, colIdx)?.parkCaret?.(at);',
		'rowRefAt(rowIdx)?.focus(0);'
	],
	misses: ['ref.focus(offset);', 'blockRefs[i] = ref;', 'const r = refAt(list, i);']
};

// ── G4.113 one reading of a `$$` math block's shape ────────────────────────

const MATH_SHAPE_HOME = 'src/lib/plugins/latex/math-shape.ts';
const ROGUE_MATH_READER = 'src/lib/plugins/latex/rogue.ts';
const DOLLAR_FENCE = String.raw`(?:\bBLOCK_FENCE\b|\bFENCE\b|['"\x60]\$\$['"\x60])`;
// A regex for the fence spells it escaped: `\$\$` in a literal, `\\$\\$` in a string.
const ESCAPED_FENCE = String.raw`\\\$\\\$|\\\\\$\\\\\$`;

const MATH_SHAPE: FileRule = {
	id: 'G4.113 a `$$` block’s shape is read in the math shape module only',
	population: under('src/lib/plugins/latex/'),
	matches: new RegExp(
		String.raw`(?:startsWith|endsWith|indexOf|lastIndexOf|includes)\(\s*${DOLLAR_FENCE}|[=!]==\s*${DOLLAR_FENCE}|${DOLLAR_FENCE}\s*[=!]==|${ESCAPED_FENCE}`
	),
	allowed: {
		[MATH_SHAPE_HOME]:
			'reads opener, body and closer for the parser, the write rule and the painter'
	},
	reaches: [MATH_SHAPE_HOME],
	reason:
		'a second reader of the `$$` shape drifts from the first, so the painted source, the bytes its blur writes and a reload stop agreeing on one edit: read it through `math-shape.ts`',
	hits: [
		at(ROGUE_MATH_READER, "if (text.startsWith('$$')) return null;"),
		at(ROGUE_MATH_READER, 'return line.text === BLOCK_FENCE;'),
		at(ROGUE_MATH_READER, 'if (inner.endsWith(FENCE)) inner = inner.slice(0, -2);'),
		at(ROGUE_MATH_READER, "if (text.indexOf('$$') === 0) return null;"),
		at(ROGUE_MATH_READER, "return text.lastIndexOf('$$') === text.length - 2;"),
		at(ROGUE_MATH_READER, 'if (line.includes(BLOCK_FENCE)) return null;'),
		at(ROGUE_MATH_READER, 'if (/^\\$\\$/.test(text)) return null;'),
		at(ROGUE_MATH_READER, "const opener = new RegExp('^\\\\$\\\\$');")
	],
	misses: [
		at(ROGUE_MATH_READER, "return { lines: [BLOCK_FENCE, '', BLOCK_FENCE] };"),
		at(ROGUE_MATH_READER, "if (opener === '$') return null;"),
		at('src/lib/plugins/mermaid/x.ts', "if (text.startsWith('$$')) return null;")
	]
};

// ── G4.114 one paint decision for a block under a range ─────────────────────

const ROGUE_PAINTER = 'src/lib/components/RoguePaint.svelte';
const COVERAGE_FIELD = String.raw`\b(?:wholeRoots|coveredWhole|startEdge|endEdge|startCells|endCells)\b`;

const RANGE_PAINT: FileRule = {
	id: 'G4.114 how a block paints under a range is decided in the selection model only',
	population: notUnder('src/lib/selection/'),
	// A dotted read, or an object pattern naming a field, assigned or typed as the coverage.
	matches: new RegExp(
		String.raw`\.(?:coveredRootHolding|rootHolding)\s*\(|\.${COVERAGE_FIELD}|\{[^{}]*${COVERAGE_FIELD}[^{}]*\}\s*(?:=(?!=)|:\s*RangeCoverage\b)`
	),
	reaches: ['src/lib/components/SelectionOverlay.svelte'],
	reason:
		'a painter that reads the coverage itself keeps its own copy of which block a range covers whole, and the end blocks paint one shape while the blocks between paint another: ask `classifyBlockForSelection` or `blockPaintsWholeBox`',
	hits: [
		at(ROGUE_PAINTER, 'const boxed = coverage.rootHolding(path) !== null;'),
		at(ROGUE_PAINTER, 'if (coverage.coveredRootHolding(path)) return;'),
		at(ROGUE_PAINTER, 'const roots = live.wholeRoots;'),
		at(ROGUE_PAINTER, 'const from = coverage.startEdge?.offset ?? 0;'),
		at(ROGUE_PAINTER, 'const run = coverage.endCells;'),
		at(ROGUE_PAINTER, 'const { wholeRoots, startEdge } = coverage;'),
		at(ROGUE_PAINTER, 'const {\n\tstartCells,\n\tcoveredWhole\n} = live;'),
		at(ROGUE_PAINTER, 'function paint({ endEdge }: RangeCoverage): void {}')
	],
	misses: [
		at(ROGUE_PAINTER, 'const box = blockPaintsWholeBox(path, coverage, null);'),
		at(ROGUE_PAINTER, 'const grid = rangeCoverage()?.grid;'),
		at(ROGUE_PAINTER, 'const { start, end } = coverage.range;'),
		at(ROGUE_PAINTER, 'if (a == { startEdge }) return;')
	]
};

const SOURCES = collectEditorSources();
describeFileRules([...RULES, ...LEAF_RANGE_RULES, REF_FOCUS, MATH_SHAPE, RANGE_PAINT], SOURCES);
describeManifests(RANGE_REPLACE, SOURCES);
describeManifests(RANGE_INDENT, SOURCES);
describeManifests(TYPED_WRITE_ASKS, SOURCES);
describeManifests(SCROLL_WRITERS, SOURCES);
describeManifests(BARE_FOCUSES, SOURCES);
describeFileRules([HELD_BRANDS], SOURCES);
describeCorrections(SOURCES);
describeOwnerWrites(SOURCES);
describeMeasureWrites(SOURCES);
describeManifests([MEASURE_CHANNEL], SOURCES);
describeManifests(HEIGHT_LIFETIME, SOURCES);
describeManifests(SELECTION_WRITERS, SOURCES);
