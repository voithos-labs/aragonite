/**
 * File rules over the shipped source: each row names a shape a file may not hold, the files
 * allowed to hold it, and the snippets its matcher must flag or spare. The scan is `file-rule.ts`;
 * a row carries its G-number where the invariant catalog has one, and every row reads the one
 * source collection taken below.
 */

import { collectEditorSources, isProseSurface, type SourceFile } from './scan-source';
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

/** A component owning a command surface: a surface factory, or its own chord dispatch. */
const COMMAND_SURFACE_RE =
	/\bcreateEditable(?:Surface|Leaf)\s*\(|\bdispatchKeyCommand\s*\(|\bdispatchChord\s*\(/;
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
	'src/lib/editor-actions/commit/undo-controller.ts',
	'src/lib/editor-actions/container-edit.ts'
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

// ── The decorations directory ────────────────────────────────────────────────

const DECORATIONS_DIR = 'src/lib/decorations/';

const DOM_MEASURES = [
	/\b(?:textContent|innerText)\b[^;\n]{0,40}\.length\b/,
	/\b\w*[Dd]omTextLength\b/,
	/\brawTextOfNode\s*\([^)]*\)\s*\.length\b/
];

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
	pairing(
		'G4.51 the container: no file pushes a debounced checkpoint without arming the pause',
		/\bpushDebouncedCheckpoint\s*\(/,
		/\barmDebouncedPause\s*\(/,
		'pushDebouncedCheckpoint',
		'armDebouncedPause'
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
			// Space homes.
			'src/lib/cursor/widget-offset.ts': 'DomTextOffset home: the walk brands its returns',
			'src/lib/cursor/content-offsets.ts': 'DomTextOffset home (widget-free variant)',
			'src/lib/cursor/sticky-measure.ts': 'EditorX/ViewportX home + walk-offset candidate scan',
			'src/lib/ambient/ambient-cursor.ts':
				'RawOffset home: the marker-prefix module converts raw from walk space',
			'src/lib/selection/table-endpoint-snap.ts':
				'CellIndex home: a row-major cell index from table geometry',
			'src/lib/selection/primitives.ts':
				'SelectionPoint accessors brand RawOffset/CellIndex for the char/cell branch reads',
			'src/lib/editor-actions/block-edit-scope.ts':
				'DocPath home: the scope factories brand the commit args’ document-absolute paths',
			'src/lib/editor-actions/commit/undo-controller.ts':
				'DocPath at the commit sequence, gating the G1.16 guard entry',
			// Public boundaries: number-typed surfaces branding at entry.
			'src/lib/components/blocks/editable-surface.ts':
				'BlockComponent boundary: public number offsets branded at entry',
			'src/lib/components/blocks/plain-text-backend.ts':
				'shared plain-text backend: with no marker prefix, DOM-text space is raw space',
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
			'src/lib/cursor/reveal-source.ts': 'block-source offsets (unbranded deps) enter the walk',
			'src/lib/selection/native-bridge.ts':
				'SelectionPoint offsets (unbranded) enter the walk; a textContent length is a DomTextOffset by construction',
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
		id: 'G4.39 every component mounting a command surface publishes runCommand',
		population: (file) => svelteOnly(file) && COMMAND_SURFACE_RE.test(file.code),
		matches: (file) => !PUBLISHES_RUN_COMMAND_RE.test(file.code),
		reason:
			'without an instance export of runCommand, editor.runCommand() declines on that block; a surface that genuinely takes no command belongs in this message, not in silence',
		// The dispatch-only signal is what widens this population past G4.38's.
		reaches: ['src/lib/components/blocks/ThematicBreakBlock.svelte'],
		atLeast: 5,
		hits: [
			at('x.svelte', 'const s = createEditableSurface({'),
			at('x.svelte', 'const leaf = createEditableLeaf({'),
			at('x.svelte', 'if (chord && dispatchKeyCommand(chord, target, ctx))'),
			at('x.svelte', 'if (wiring.dispatchChord(e, { kind, runCommand }))'),
			at('x.svelte', 'createEditableSurface({}); const x = component.runCommand;'),
			at('x.svelte', 'createEditableSurface({}); if (!component?.runCommand) return null;')
		],
		misses: [
			at('x.svelte', 'dispatchKindCommand(chord, target, gates)'),
			at('x.svelte', 'import type { EditableLeaf } from'),
			at('x.svelte', 'createEditableSurface({}); export const runCommand = leaf.runCommand;'),
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
				'G1.33 resolves the host as the focused editable and does nothing on its emptiness',
			'src/lib/selection/caret-restore.ts':
				'a caret saved at whole-block focus restores TO the host, the wanted target',
			'src/lib/selection/cross-block/pointer.ts':
				'a shift-click anchored on a whole-block kind resolves to the host, so the dispatch takes the unit whole',
			'src/lib/selection/dead-space-caret.ts':
				'reads hit.charSurface, which the hit-test already withdrew the host from'
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
			'src/lib/ambient/ambient-cursor.ts':
				'the prose surface this cursor was constructed over; a whole-block kind has none',
			'src/lib/components/blocks/editable-surface.ts':
				'the pending-restore guard, reachable only from an editable leaf surface',
			'src/lib/cursor/content-offsets.ts':
				'the caller supplies a block text surface, never the host',
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
	}
];

describeFileRules(RULES, collectEditorSources());
