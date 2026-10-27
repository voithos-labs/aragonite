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
	quotedSpecifierEnding,
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
import { SOURCE, SOURCE_DIR } from './source-paths';

const at = (relPath: string, code: string): Probe => ({ relPath, code });

// ── G4.15 coordinate brands ──────────────────────────────────────────────────

const COORDINATE_HOME = SOURCE.coordinateBrands;
const BRANDS = ['RawOffset', 'DomTextOffset', 'EditorX', 'ViewportX', 'CellIndex', 'DocPath'];

/** Where each brand's bare `as <Brand>` cast may live. */
const BRAND_CAST_HOME: Record<string, string[]> = {
	RawOffset: [COORDINATE_HOME],
	DomTextOffset: [COORDINATE_HOME],
	EditorX: [COORDINATE_HOME],
	ViewportX: [COORDINATE_HOME],
	CellIndex: [COORDINATE_HOME],
	DocPath: [COORDINATE_HOME]
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
const CST_DOCUMENT_IMPORT_RE = new RegExp(
	String.raw`import[^;]*\bDocument\b[^;]*from\s+` + quotedSpecifierEnding('core/nodes')
);

/** `as Document` counts only where the CST `Document` is imported; elsewhere it is the DOM one. */
function stripsView(file: SourceFile): boolean {
	const countsDocument = CST_DOCUMENT_IMPORT_RE.test(file.code);
	return [...file.code.matchAll(STRIP_CAST_RE)].some((m) => m[1] !== 'Document' || countsDocument);
}

const CST_IMPORT = "import type { CstNode, Document } from '../core/nodes';\n";

// ── G4.44 / G4.65 prose surfaces ─────────────────────────────────────────────

const LIVE_EDIT_HOME = SOURCE.liveSelectionEdit;
const AUTOPAIR_HOME = SOURCE.delimiterAutopair;
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

const TYPED_INPUT_HOME = SOURCE.typedInput;
const CREATES_TYPED_INPUT = /(?<![\w.])createTypedInput\s*\(/;

/** Both directions of a surface rule: every prose surface builds the shared typed-input step, and
 *  that step is the resolver's one caller outside its home. */
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
			matches: (file) => !CREATES_TYPED_INPUT.test(file.code),
			reason,
			atLeast: 2,
			hits: [at(ROGUE_SURFACE, PROSE_SURFACE)],
			misses: [at(ROGUE_SURFACE, `${PROSE_SURFACE} createTypedInput(deps);`)]
		},
		{
			id: `${id}: the shared typed-input step is its one caller`,
			population: callsResolver,
			matches: (file) => file.relPath !== TYPED_INPUT_HOME,
			reason:
				'the resolver prevents the default and owns where the caret lands, so a prose surface reaches it through `createTypedInput`, never on its own',
			reaches: [TYPED_INPUT_HOME],
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

// ── G4.71 / G4.72 Markdown whitespace ────────────────────────────────────────

/** `x.trim() === ''`, `x.trim().length === 0` and `!x.trim()`: an emptiness test by `trim()`. */
const EMPTY_BY_TRIM =
	/\.trim\(\)\s*(?:[!=]==\s*''|\.length\s*(?:[!=]==|[<>]=?)\s*[01]\b)|!\s*[\w$.?[\]()]+\.trim\(\)\s*(?:[)&|;?]|$)/m;

/** The grammar files outside `core/parsers/` whose whitespace is GFM's: the one class home, the
 *  bare autolink boundary, the tag grammar and label matching. */
const GRAMMAR_FILES: string[] = [
	SOURCE.lineSplitter,
	SOURCE.autolinkGrammar,
	SOURCE.htmlTagGrammar,
	SOURCE.linkGrammar
];

const PARSER_PROBE = `${SOURCE_DIR.blockParsers}probe.ts`;

/** Plugin grammars share the parser's whitespace: the directive grammar and the bundled plugins. */
const PLUGIN_GRAMMAR_DIRS = [SOURCE_DIR.directive, SOURCE_DIR.plugins];

const SHOWS_INK = 'whether the render shows ink, not whether the Markdown is blank';

// ── The decorations directory ────────────────────────────────────────────────

const DECORATIONS_DIR = SOURCE_DIR.decorations;

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
	'placeholder',
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

const TEXT_BLOCK_DIR = SOURCE_DIR.textBlock;
const LIVE_EDIT_DIR = SOURCE_DIR.liveEdit;
const LIVE_EDIT_PROBE = `${LIVE_EDIT_DIR}probe.ts`;

/** The text block's helper modules, where every live rewrite lives, and the live-edit readers. */
const holdsLiveRewrites = (file: SourceFile): boolean =>
	file.relPath.startsWith(LIVE_EDIT_DIR) ||
	(file.relPath.startsWith(TEXT_BLOCK_DIR) &&
		/^[^/]+\.ts$/.test(file.relPath.slice(TEXT_BLOCK_DIR.length)));

/** A read of a list item's marker: off its metadata, or off a parse cast to carry one. */
const LIST_MARKER_READ =
	/\{\s*marker\?:\s*string\s*\}|'listItem'\)\??\.marker\b|\b\w*[mM]eta(?:data)?\??\.marker\b/;

// ── G4.34 private writer ─────────────────────────────────────────────────────

/** Writers whose callers are their own module: unexported today, held here so one `export`
 *  keyword can't hand them a second caller. */
const PRIVATE_WRITER_HOMES: Record<string, string> = {
	buildLinkSourceBytes: SOURCE.linkSourceBytes
};

// ── G4.175 runes mode ────────────────────────────────────────────────────────

/** What puts a component in runes mode: a rune, or the explicit option. */
const RUNES_MODE_RE =
	/\$(?:props|state|derived|effect|bindable|host|inspect)\b|<svelte:options[^>]*\brunes\b/;

// ── G4.178 plugin views mount behind a fallback ──────────────────────────────

/** Where the editor paints a Svelte component a plugin supplied: a `mount`, or a component chosen
 *  at render time. */
const MOUNTS_PLUGIN_VIEW =
	/import\s*\{[^}]*\bmount\b[^}]*\}\s*from\s*'svelte'|\{@const\s+[A-Z]\w*\s*=|<svelte:component\b/;

const PLUGIN_VIEW_FALLBACK: FileRule = {
	id: 'G4.178 every route that mounts a plugin view contains its failure',
	population: under(SOURCE_DIR.library),
	matches: (file) =>
		MOUNTS_PLUGIN_VIEW.test(file.code) && !/\bwarnIfForeignRuntime\(/.test(file.code),
	allowed: {
		'src/lib/create-editor.ts': 'mounts the editor itself, which no plugin supplies',
		'src/lib/svelte-view.svelte.ts':
			'its views mount only through `plugin-view.ts :: mountPluginView`, which contains their throws'
	},
	reason:
		'a plugin view that throws must fall back, report on the `error` event and name a foreign Svelte runtime in dev: catch it and call `warnIfForeignRuntime` with the reporter, as `plugin-view.ts` does',
	reaches: [SOURCE.blockHost, SOURCE.inlineWidgets],
	hits: [
		at('src/lib/x.ts', "import { mount, unmount } from 'svelte';\nmount(C, { target });"),
		at('src/lib/x.svelte', '{@const Row = view.source.row}\n<Row {item} />')
	],
	misses: [
		at('src/lib/x.ts', "import { tick } from 'svelte';\nawait landing.mount(path);"),
		at('src/lib/x.svelte', '{@const cause = foreignRuntimeCause(error)}'),
		at(
			'src/lib/x.ts',
			"import { mount } from 'svelte';\ntry {\n\tmount(C, { target });\n} catch (e) {\n\twarnIfForeignRuntime(e, 'x');\n}"
		)
	]
};

// ── G4.186 one wrapper draws every plugin view ───────────────────────────────

/** A call on a plugin's view, by its field or a local of the same name: a route drawing an inline
 *  widget, decoration widget or menu row itself. A local under another name is past its reach. */
const CALLS_PLUGIN_VIEW =
	/(?<![\w$.]|\bas\s+|\bfunction\s+)(?:view|row)\s*(?:\?\.\s*)?\(|\.(?:view|row)\s*(?:\?\.\s*)?(?:\(|\.(?:call|apply)\b)/;

const ONE_VIEW_WRAPPER: FileRule = {
	id: 'G4.186 a plugin view is drawn only through mountPluginView',
	population: under(SOURCE_DIR.library),
	matches: CALLS_PLUGIN_VIEW,
	allowed: {
		'src/lib/plugin-view.ts': 'the wrapper itself, the one place a view is called'
	},
	reason:
		'an inline widget, decoration widget or menu row view mounts through `plugin-view.ts :: mountPluginView`, which contains a throw at mount, update or destroy, reports it once and destroys the view once: hand the view to it instead of calling it',
	reaches: [SOURCE.pluginView],
	hits: [
		at('src/lib/x.ts', 'const handle = spec.view(target, { decoration });'),
		at('src/lib/x.svelte', '{@attach (el) => source.row (el, props)}'),
		at('src/lib/x.ts', 'const view = getInlineWidgetView(kind, grammar);\nview(shell, props);'),
		at('src/lib/x.ts', 'spec.view?.(target, props);'),
		at('src/lib/x.ts', 'spec.view.call(null, target, props);')
	],
	misses: [
		at('src/lib/x.ts', 'mountPluginView(spec.view, target, props, opts);'),
		at('src/lib/x.ts', 'const view = getInlineWidgetView(kind, grammar);'),
		at('src/lib/x.svelte', '{#each rows as row (row.command)}'),
		at('src/lib/x.ts', 'records.preview(block, side);')
	]
};

// ── G4.221 the selection's shown text ────────────────────────────────────────

const SELECTION_STRING_RE = /(?:\bgetSelection\(\)|\bsel(?:ection)?)\s*[!?]?\.toString\s*\(/;
const SELECTION_BINDING_RE = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:\w+\.)?getSelection\(\)/g;

/** A selection's string read inline, through a `sel`-style name, or through any name bound to a
 *  `getSelection()` result in the same file. */
function readsSelectionString(file: SourceFile): boolean {
	if (SELECTION_STRING_RE.test(file.code)) return true;
	return [...file.code.matchAll(SELECTION_BINDING_RE)].some(([, name]) =>
		new RegExp(String.raw`\b${name}\s*[!?]?\.toString\s*\(`).test(file.code)
	);
}

// ── The rules ────────────────────────────────────────────────────────────────

/** A file the G4.80 population holds, for its probes. */
const SELECTION_PROBE = `${SOURCE_DIR.selection}probe.ts`;

const RULES: FileRule[] = [
	{
		id: 'G4.4 no timing hacks for sequencing',
		matches: /\b(?:setTimeout|setInterval|queueMicrotask|requestAnimationFrame)\s*\(/,
		allowed: {
			'src/lib/selection/autoscroll.ts': 'rAF autoscroll loop: an animation cadence, not ordering',
			'src/lib/windowing/observe-resize.ts':
				'rAF start of a size observation: one begun while a frame delivers resize notifications is skipped and reported as a loop error',
			'src/lib/components/drag-handle.ts':
				'rAF placement of the drag handle once its block has laid out; the handle is its own hit target before any hover',
			'src/lib/caret/drawn-caret.svelte.ts':
				'frame-time paint of a caret the browser moved: reads layout, writes only the caret element (G4.143)',
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
		id: 'G4.240 every ResizeObserver is made in observe-resize.ts',
		matches: /\bnew\s+(?:(?:globalThis|window|self)\s*\.\s*)?ResizeObserver\b/,
		allowed: {
			'src/lib/windowing/observe-resize.ts':
				'the one home of size observation: its entry points own when observing starts and how reports arrive'
		},
		reason:
			'how the browser delivers size reports (an element observed mid-delivery is skipped, a size changed mid-delivery is a loop error) is handled once; watch through `observeResize`, `observeResizeNow` or the shared watch',
		hits: [
			'const o = new ResizeObserver(cb);',
			'new  ResizeObserver(() => {})',
			'new globalThis.ResizeObserver(cb)',
			'new window.ResizeObserver(cb)'
		],
		misses: ['let o: ResizeObserver | null = null;', "typeof ResizeObserver !== 'function'"]
	},
	{
		id: 'G4.260 a step before the render pairs with its after step through aroundRender',
		matches: /\$effect\.pre\s*\(/,
		allowed: {
			'src/lib/around-render.svelte.ts':
				'the pairing itself: each run before the render schedules its own run after it',
			[SOURCE.listWindowing]:
				'records the list path before the render, with no step after the render to pair'
		},
		reason:
			'two effects over one value, one before the render and one after, lose the after step when an effect moves the value again inside the flush; pair them with `aroundRender`',
		hits: [
			'$effect.pre(() => {\n\tconst mode = effectiveMode;\n});',
			'$effect.pre (() => hold(getWindow()));'
		],
		misses: [
			'aroundRender(() => effectiveMode, flip.beforeFlip, flip.afterFlip);',
			'$effect(() => release());',
			'// $effect.pre(() => {})'
		]
	},
	{
		id: 'G4.245 a kind’s write rule runs through kindWriteRule',
		matches: /\.rawWrite\b|\{[^}=]*\brawWrite\b[^}=]*\}\s*=[^=>]/,
		allowed: {
			'src/lib/tree-operations/node-primitives.ts':
				'`kindWriteRule`: the one reader, which checks that a rule deletes no byte the write left alone',
			'src/lib/invariants/leaf-text.ts': 'reads the rule’s `text`, a block’s text, not a write',
			'src/lib/testing/kind-conformance.ts':
				'the conformance kit drives a plugin kind’s rule directly against its fixture'
		},
		reason:
			'a rule run outside `kindWriteRule` skips the dev check that it deletes no byte outside the written span (G1.143); read it through `kindWriteRule`',
		hits: [
			'const rule = tryGetBlockKindDescriptor(node.kind)?.rawWrite;',
			'getBlockKindDescriptor(kind).rawWrite!.normalize(raw, ctx)',
			'const { rawWrite } = descriptor;'
		],
		misses: ['registerBlockKind(kind, { rawWrite: fencedCodeWrite });', 'rawWrite: mathBlockWrite,']
	},
	{
		id: 'G4.194 a block reaches the clipboard steps and the inline paste through its surface',
		matches: /(?<!function\s)\b(?:createClipboardHandlers|pasteDispatch)\s*\(/,
		allowed: {
			'src/lib/components/blocks/editable/editable-surface.ts':
				'`clipboard`: the surface fills in the editor-wide half for every block',
			'src/lib/components/blocks/editable/surface-clipboard.ts':
				'`pasteIntoBlock`: the one paste into a block’s own text, which the surface’s `pasteInline` calls',
			'src/lib/selection/cross-block/range-replace.ts':
				'a paste over a range across blocks, which lands where the range’s delete left the caret'
		},
		reason:
			'a block that builds its own clipboard or dispatches its own paste copies the editor-wide fields and the caret park, and a copy drifts: go through `editableSurface.clipboard` and `pasteInline`',
		hits: ['const c = createClipboardHandlers({ rangeArm });', 'await pasteDispatch(input, ctx);'],
		misses: [
			'export function createClipboardHandlers(deps) {}',
			'export async function pasteDispatch(\n\tinput,'
		]
	},
	{
		id: 'G4.201 one painter puts the selection wash on a widget',
		matches: /(['"`])md-widget-selected\1|\bclass:md-widget-selected\b/,
		allowed: {
			'src/lib/selection/widget-selection-paint.ts':
				'the one painter: the widget held selected whole, else the widgets a browser range overlaps'
		},
		reason:
			'a second place writing the selection wash paints by its own idea of what is selected, and a widget shape it forgets shows nothing while the next key replaces it: let `installWidgetSelectionPainter` paint it',
		hits: [
			"el.classList.add('md-widget-selected');",
			'const SELECTED = "md-widget-selected";',
			'<span class:md-widget-selected={held}></span>'
		],
		misses: [
			"page.locator('.md-widget-selected');",
			'// paints `md-widget-selected` here\nconst a = 1;',
			':global(.md-widget-selected) { outline: none; }'
		]
	},
	{
		id: 'G4.209 a list item draws its marker in its own cell, never through a child’s prefix',
		matches: /\bambientPrefixForFirst\b/,
		allowed: {
			'src/lib/components/BlockList.svelte':
				'hands a plugin container’s prefix to its first text child',
			'src/lib/editor-actions/plugin/container.ts': 'offers a plugin container’s declared prefix'
		},
		reason:
			'a prefix handed to a child paints only on a text block, so an item opening with any other block draws no marker and hides its bytes; a list item draws its marker in its own cell (`ListItemBlock`)',
		hits: [
			'ambientPrefixForFirst={buildTaskItemAmbient(meta, toggle, drawsBox)}',
			'get ambientPrefixForFirst() {'
		],
		misses: ['// ambientPrefixForFirst goes to text only\nconst a = 1;', 'const ambientPrefix = 1;']
	},
	{
		id: 'G4.214 a caret’s box is measured in one place',
		matches:
			/(?:\b\w*[rR]ange\??|\bgetRangeAt\([^)]*\))\.get(?:ClientRects|BoundingClientRect)\s*\(/,
		allowed: {
			'src/lib/browser/lines.ts':
				'`caretRectAt`, the one measure of a caret, and the character and line boxes it reads',
			'src/lib/components/overlays/rects.ts': 'the boxes of a span between two offsets',
			'src/lib/components/blocks/text/widget-interaction.ts':
				'a shown source’s whole box, for a double-click’s hit test',
			'src/lib/editor-rects.ts': 'a selection’s box; a collapsed one goes through `caretRectAt`',
			'src/lib/selection/cross-block/pointer.ts':
				'whether a selected range covers a right-click; a collapsed one is never measured'
		},
		reason:
			'WebKit and Firefox measure a caret right after a `\\n` on the line the `\\n` ends, so a caret measured anywhere else reads the wrong line at every line start: call `caretRectAt`, or `charRect` for one character',
		hits: [
			'const rects = range.getClientRects();',
			'return sel.getRangeAt(0).getBoundingClientRect();',
			'const box = probeRange?.getBoundingClientRect();'
		],
		misses: ['const box = el.getBoundingClientRect();', 'const rects = block.getClientRects();']
	},
	{
		id: 'G4.243 the caret’s line is decided through the soft-wrap read',
		matches: /\bcaretRectAt(?:Raw)?\s*\(/,
		allowed: {
			'src/lib/browser/lines.ts':
				'`caretRectAt` itself, and the line decisions, which ask the browser at a soft wrap first',
			'src/lib/caret/sticky-measure.ts':
				'the column: the caret’s own x after the soft-wrap read, and the column search over offsets that are no caret',
			'src/lib/caret/drawn-caret-measure.ts':
				'the drawn caret’s box, which steps aside for the browser’s own caret at a soft wrap',
			'src/lib/selection/caret-landing.ts':
				'the box scrolled into view, where a line off at a soft wrap still shows the caret',
			'src/lib/selection/selection-drop.ts':
				'the drop caret, at a point the pointer chose, not the caret',
			'src/lib/selection/page-step.ts':
				'the line a page step starts from, a line high at a soft wrap (ledger: a page step from a soft wrap starts a line high)',
			'src/lib/editor-rects.ts':
				'`rects.caretRect()` for a consumer, the measured line at a soft wrap (ledger: `caretRect()` at a soft wrap reports the measured line)'
		},
		reason:
			'at a soft wrap a caret’s one DOM position is on two lines and a measure reads one of them whatever the browser shows, so a line decided off `caretRectAt` is wrong there: use `isAtFirstVisualLine`, `isAtLastVisualLine`, `lineEdgeOffset` or `focusCaretAtWrap`, which ask the browser',
		hits: [
			'const top = caretRectAt(el, node, offset)?.top;',
			'const box = caretRectAtRaw(el, raw);',
			'deps.caretRectAt(root, n, o)'
		],
		misses: ['import { caretRectAt } from "./lines";', 'caretRectAt,']
	},
	{
		id: 'G4.221 a paste with no paste event calls the paste step, never a constructed event',
		matches: /\bnew\s+(?:\w+\.)?ClipboardEvent\s*\(/,
		allowed: {},
		reason:
			'Firefox empties `clipboardData` on a constructed `ClipboardEvent`, so a paste dispatched as one pastes nothing: hand the text to the focused block’s `insertMarkdown`',
		hits: [
			"el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));",
			"const e = new ClipboardEvent ('copy');",
			"target.dispatchEvent(new window.ClipboardEvent('paste'));"
		],
		misses: ['function onPaste(e: ClipboardEvent): void {}', 'const e = event as ClipboardEvent;']
	},
	{
		id: 'G4.221 the shown text of a selection is read in one place',
		matches: readsSelectionString,
		allowed: {
			[SOURCE.selectionRead]:
				'`shownSelectionText`: LF line breaks, and nothing for an empty block’s placeholder `<br>`'
		},
		reaches: [SOURCE.selectionRead],
		reason:
			'Firefox on Windows writes a selection’s line breaks as CRLF and an empty block’s placeholder `<br>` as one, so the text read straight off the selection differs by engine: call `shownSelectionText`',
		hits: [
			"const text = window.getSelection()?.toString() ?? '';",
			'return sel.toString();',
			'document.getSelection()!.toString()',
			'selection?.toString()',
			"const live = window.getSelection();\nreturn live?.toString() ?? '';"
		],
		misses: [
			'const n = range.toString().length;',
			'const s = (5).toString();',
			'const live = window.getSelection();\nconst n = live?.rangeCount ?? id.toString();'
		]
	},
	{
		id: 'G4.248 every dev-only check reads the build flag through the dev-checks module',
		matches: /from\s*['"]esm-env['"]|\bNODE_ENV\b/,
		allowed: {
			[SOURCE.devChecks]: 'the one reader: devChecksOn answers for every dev-only check'
		},
		reason:
			'a check reading DEV or NODE_ENV itself ships in a production build and stays off under configureEditorEnv({ isDev: true }): read devChecksOn from @voithos-labs/aragonite/dev-checks',
		reaches: [SOURCE.devChecks],
		hits: [
			"import { DEV } from 'esm-env';",
			'import { BROWSER, DEV } from "esm-env";',
			"if (process.env.NODE_ENV !== 'production') warn();"
		],
		misses: ["import { devChecksOn } from '@voithos-labs/aragonite/dev-checks';"]
	},
	{
		id: 'G4.248 the dev-checks module is imported by its package name alone',
		matches:
			/['"`](?:(?:\.{1,2}\/[^'"`]*|#lib\/)dev-checks|[^'"`]*dev-checks-stripped)(?:\.(?:js|ts))?['"`]/,
		reason:
			'svelte-package turns a relative or #lib spelling into a file path, so a production build never swaps in the stripped copy and ships every check: import @voithos-labs/aragonite/dev-checks',
		atLeast: 100,
		hits: [
			"import { devWarn } from '../dev-checks';",
			"import { devWarn } from '#lib/dev-checks.js';",
			"import { devChecksOn } from './dev-checks-stripped';"
		],
		misses: [
			"import { devWarn } from '@voithos-labs/aragonite/dev-checks';",
			"import { x } from './dev-checks-panel';"
		]
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
		reaches: [SOURCE.nodePrimitives],
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
		id: 'G4.175 every library component compiles in runes mode',
		population: (file) => svelteOnly(file) && file.relPath.startsWith(SOURCE_DIR.library),
		matches: (file) => !RUNES_MODE_RE.test(file.code),
		reason:
			'a component with no rune compiles in legacy mode in a Svelte host, which turns on the legacy flag in the Svelte runtime of that app: add `<svelte:options runes />`',
		reaches: [SOURCE.blockHost],
		hits: [
			at('src/lib/x.svelte', '<span class="grip"></span>'),
			at('src/lib/x.svelte', '<script>\n\texport let name;\n</script>\n<p>{name}</p>')
		],
		misses: [
			at('src/lib/x.svelte', '<svelte:options runes />\n<span class="grip"></span>'),
			at('src/lib/x.svelte', '<script>\n\tlet { node } = $props();\n</script>')
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
		reaches: [SOURCE.blockList, SOURCE.listBlock, SOURCE.tableBlock],
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
		population: except(SOURCE.scrollport),
		matches: /setScrollTop\s*\([^;]*?\.scrollTop\s*\(\s*\)/,
		reason:
			'a relative scroll goes through port.scrollBy(delta), which keeps the fraction the scroller refuses (#315)',
		reaches: [SOURCE.scrollOwner],
		hits: [
			'port.setScrollTop(port.scrollTop() + delta);',
			'el.setScrollTop(el.scrollTop() - lost);'
		],
		misses: [
			'port.setScrollTop(target);\nconst at = port.scrollTop();',
			'port.setScrollTop(listTopInPort(port, listEl) + model.offsetOf(index));'
		]
	},
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
			[COORDINATE_HOME]: 'the conversions themselves, asDocPath included',
			// Modules that own a coordinate space.
			'src/lib/browser/offsets.ts': 'DomTextOffset home: the walk brands its returns',
			'src/lib/caret/sticky-measure.ts': 'EditorX/ViewportX home + walk-offset candidate scan',
			'src/lib/components/blocks/editable/surface-backend.ts':
				'RawOffset home for the caret intent a block records as a plain number (the snap target)',
			'src/lib/selection/table-endpoint-snap.ts':
				'CellIndex home: a row-major cell index from table geometry',
			'src/lib/selection/primitives.ts':
				'SelectionPoint accessors brand RawOffset/CellIndex for the char/cell branch reads',
			'src/lib/editor-actions/block-edit-scope.ts':
				'DocPath home: the scope factories brand the commit args’ document-absolute paths',
			'src/lib/editor-actions/commit/commit-frame.ts':
				'DocPath at the commit frame, gating the G1.16 guard entry',
			// Public boundaries, where plain-number offsets are branded on entry.
			'src/lib/components/blocks/editable/editable-surface.ts':
				'BlockComponent boundary: public number offsets branded at entry',
			'src/lib/components/blocks/editable/editable-leaf.ts':
				'plugin-leaf surface: zero-prefix DOM-text mutations brand raw offsets in place',
			'src/lib/components/blocks/code/CodeBlock.svelte':
				'code surface: zero-prefix DOM-text mutations brand raw offsets in place',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'zero-prefix cell: a widget edge offset brands across the identity',
			'src/lib/components/blocks/table/TableBlock.svelte':
				'table sticky-X exit re-enters the editor column state',
			'src/lib/components/blocks/text/widget-interaction.ts':
				'CST inline offsets (unbranded model values) enter cursor IO',
			'src/lib/components/blocks/text/inline-commands.ts':
				'Edit link puts the caret at a construct’s text end, a CST offset (unbranded model value)',
			'src/lib/components/blocks/text/typed-input.ts':
				'the auto-pair’s caret, counted in the block’s displayed text, enters cursor IO',
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
			SOURCE.codeBlockComponent,
			SOURCE.tableCell,
			SOURCE.textBlockComponent,
			SOURCE.editableLeaf
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
		id: 'G4.13 no view-stripping cast outside tree-operations and the structural commit',
		population: notUnder(SOURCE_DIR.treeOperations, SOURCE.structuralCommit, SOURCE.cstNodes),
		matches: stripsView,
		mustMatch: [SOURCE.unshare],
		reason:
			'a CstNode/Document cast re-opens the byte-write hazard G1.9 closes in the types; route through makeBlockNode or the copy-before-write module instead',
		hits: [
			'const n = view as CstNode;',
			'const n = doc as unknown as CstNode;',
			`${CST_IMPORT}const d = view as Document;`,
			`${CST_IMPORT}const d = (x as Document & { y?: number }).y;`,
			"import type { Document } from '#lib/core/nodes.js';\nconst d = view as Document;",
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
		population: except(SOURCE.inlineCache),
		matches: /\bgetInlineContent\b/,
		allowed: {
			'src/lib/core/inline/transparency.ts':
				'the vertical-skip decision, run by path walkers holding no linkRef; its header states the resolver-less answer as its contract'
		},
		reason:
			'a caller dropping the resolver or the signature reads a different cache sub-entry from the one the render filled; go through resolvedInlineContent',
		hits: [
			'const x = getInlineContent(node);',
			"import { getInlineContent as read } from './inline-cache';"
		],
		misses: ['// getInlineContent(node) would be wrong', 'const x = resolvedInlineContent(node);']
	},
	...surfaceParity(
		'G4.44 every prose surface resolves native ranged edits through resolveLiveRangeEdit',
		LIVE_EDIT_HOME,
		RESOLVES_LIVE_EDIT,
		'resolveLiveRangeEdit(e, node, cursor, r);',
		'a prose surface reads the pending range off getTargetRanges() through resolveLiveRangeEdit, by way of `createTypedInput`; the live selection alone loses every word, line and drag delete at a collapsed caret'
	),
	...surfaceParity(
		'G4.65 every prose surface hands typed delimiters to applyDelimiterAutoPair',
		AUTOPAIR_HOME,
		APPLIES_AUTOPAIR,
		'applyDelimiterAutoPair(e, deps);',
		'a prose surface hands its typed delimiters to applyDelimiterAutoPair through `createTypedInput`, which pairs, steps over and closes them; a local copy drifts'
	),
	{
		id: 'G4.39 every component mounting the text surface publishes runCommand',
		population: (file) => svelteOnly(file) && COMMAND_SURFACE_RE.test(file.code),
		matches: (file) => !PUBLISHES_RUN_COMMAND_RE.test(file.code),
		reason:
			'without an instance export of runCommand, editor.runCommand() declines every built-in text command on that block',
		reaches: [SOURCE.tableCell],
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
			'src/lib/components/blocks/editable/surface-backend.ts':
				'the editable surface this backend was built over; a whole-block kind builds none',
			'src/lib/components/blocks/editable/editable-surface.ts':
				'the pending-restore guard, reachable only from an editable leaf surface',
			'src/lib/caret/reveal-source.ts':
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
			under(SOURCE_DIR.blockParsers)(file) ||
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
		reaches: [...GRAMMAR_FILES, SOURCE.directiveGrammar],
		reason:
			'JS `\\s` and `trim()` admit a non-breaking space, and GFM (§2.1) never does: a rule wanting spaces or tabs says `[ \\t]`, one wanting whitespace reads `WHITESPACE_CLASS`, `isWhitespaceChar` or `trimWhitespace` (core/lines.ts)',
		hits: [
			at(PARSER_PROBE, 'const m = text.match(/^#(?:\\s|$)/);'),
			at(PARSER_PROBE, 'new RegExp(`^x\\\\s*$`);'),
			at(PARSER_PROBE, 'const trimmed = text.trim();'),
			at(PARSER_PROBE, 'const head = text.trimStart();'),
			at(PARSER_PROBE, 'const tail = text.trimEnd();'),
			at(SOURCE.autolinkGrammar, 'const m = s.match(/^(\\S+)/);'),
			at(
				`${SOURCE_DIR.latexPlugin}latex-kind.ts`,
				'const isSpace = (ch: string) => /\\s/.test(ch);'
			),
			at(SOURCE.directiveGrammar, 'const title = info.trim();')
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
		id: 'G4.34 the link serializer is named only in its own file',
		matches: (file) =>
			Object.entries(PRIVATE_WRITER_HOMES).some(
				([name, home]) => file.relPath !== home && new RegExp(`\\b${name}\\b`).test(file.code)
			),
		reason:
			're-emitting a link’s fields as GFM replaces an author’s own syntax: call the byte writer',
		hits: [at(SOURCE.fixUpApply, 'buildLinkSourceBytes(fields);')],
		misses: [at(SOURCE.linkSourceBytes, 'return buildLinkSourceBytes(fields);')]
	},
	{
		id: 'a value the editor owns is read through its getter, never optional-chained into a default',
		matches: new RegExp(
			`\\b(?:${EDITOR_GETTERS.join('|')})\\?\\.\\(|(?:\\?\\?|\\|\\|)\\s*'(?:source|reading)'`
		),
		allowed: {
			'src/lib/browser/painted.ts':
				'the mode a mounted block wears in the DOM, where no hiding attribute means source'
		},
		reason:
			'the editor passes every one of these getters and decides each default once, so a reader’s own fallback can only disagree with it: call the getter as given',
		hits: [
			"const isReading = (getPresentationMode?.() ?? 'source') === 'reading';",
			'const on = $derived(getDragHandles?.() ?? false);',
			'const doc = getDocument?.();',
			'if (path) void navigateTo?.(path);',
			"const mode = reading.mode() || 'source';"
		],
		misses: [
			"const isReading = getPresentationMode() === 'reading';",
			'navigateTo: (path) => rects?.navigateTo(path) ?? Promise.resolve(false),',
			"if (mode === 'reading') return;"
		]
	},
	{
		id: 'G4.77 only the editor’s own registrations run on behalf of no plugin',
		// The bare name, so an aliased import is flagged at its import line.
		matches: /\bregisterAsCore\b/,
		allowed: {
			'src/lib/schema/plugin-install.ts':
				'the function itself, which runs its callback with no plugin installing',
			'src/lib/components/editor-built-ins.ts':
				'the editor’s own bootstraps (blocks, code languages, context-menu rows), which the reset keeps',
			'src/lib/schema/plugin-registry.ts':
				'`registerCore`, which also flags a key the registry can’t tell is built-in so the reset keeps it',
			'src/lib/schema/built-in-descriptors.ts':
				'the built-in kinds, whose first registration can fall inside a plugin’s setup (the first grammar read)',
			'src/lib/components/blocks/directive/activate-directives.ts':
				'the directive grammar and its components, which a consumer may turn on from a plugin’s setup and the reset drops',
			'src/lib/schema/commands.ts':
				'the editor’s own global commands, registered as the module loads',
			'src/lib/tree-operations/paste/hooks.ts':
				'the built-in kinds’ default paste surfaces, registered as the module loads',
			'src/lib/core/parsers/table-completion.ts':
				'the table’s Enter completer, registered as the parser loads',
			'src/lib/core/inline/inline-widgets.ts':
				'`registerCoreInlineWidget`, the inline widgets the editor draws itself'
		},
		reason:
			'an entry belongs to no plugin only through one of these routes: an editor built-in goes in `registerEditorBuiltIns` or registers as its module loads, a built-in key the reset can’t recognize goes through `registerCore`, and a kind a plugin declared already answers to that plugin',
		hits: [
			'registerAsCore(() => registerLanguage(name, grammar));',
			"import { registerAsCore as runUnowned } from './plugin-install';"
		],
		misses: ['grammars.registerCore(key, language);', 'registerAsCoreLater();']
	},
	{
		id: 'G4.249 a measured height enters the height table and the estimator only through applyMeasured',
		matches: /\.(?:recordMeasured|setHeight)\s*\(/,
		allowed: {
			'src/lib/windowing/list-windowing.svelte.ts':
				'`applyMeasured`, which holds a height within a pixel of its record as that record'
		},
		reason:
			'a height written around it skips the sub-pixel noise rule, and a block that remounts a fraction of a pixel off moves the scroll under the reader: call the list’s `applyHeight`',
		hits: ['deps.oracle.recordMeasured(id, h);', 'table.model.setHeight (i, h);'],
		misses: ['recordMeasured(id: string, height: number): void;', 'oracle.measured(id);']
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
		population: under(SOURCE_DIR.selection),
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
			'src/lib/core/coordinate-spaces.ts': 'defines the rectangle two cells span',
			'src/lib/selection/primitives.ts': 'defines the cell index read of a table endpoint',
			'src/lib/schema/block-kind-descriptor.ts':
				"defines a table's cell count and the clamp every cell index takes",
			'src/lib/selection/table-endpoint-snap.ts':
				'snaps a table endpoint to its row for `coverRange`, before any coverage exists',
			'src/lib/invariants/selection-endpoints.ts':
				"checks a stored cell endpoint lies inside its table's cells",
			'src/lib/selection/table-rect-extend.ts':
				"moves a rectangle's focus cell one step on Shift+arrow, an edit of the selection",
			'src/lib/selection/cross-block/range-delete/range-delete-table.ts':
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
			'src/lib/selection/cross-block/range-delete/range-delete-chrome.ts':
				'defines the caret read, and a range that took its start container whole and runs on',
			'src/lib/selection/cross-block/range-delete/range-delete-table.ts':
				'the same range, ending in a table'
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
		reaches: [
			`${LIVE_EDIT_DIR}live-split.ts`,
			`${LIVE_EDIT_DIR}live-join.ts`,
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
			'src/lib/tree-operations/list/ordered-markers.ts':
				'renumbers an ordered list, and asks whether two items read as one list',
			'src/lib/tree-operations/list/task-paragraph.ts':
				'measures how far a new item’s first line widens its marker, for the item to take it',
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
	},
	{
		id: 'G4.145 a click asks the shared rule whether it follows, never Ctrl or Cmd by hand',
		population: (file) => /\bonclick\b|\bonClick\b|['"]click['"]|\bMouseEvent\b/.test(file.code),
		matches:
			/\.ctrlKey\s*\|\|\s*\w+\.metaKey|\.metaKey\s*\|\|\s*\w+\.ctrlKey|!\s*\w+\.ctrlKey\s*&&\s*!\s*\w+\.metaKey|!\s*\w+\.metaKey\s*&&\s*!\s*\w+\.ctrlKey/,
		allowed: {
			'src/lib/activation-click.ts': 'the rule itself',
			'src/lib/components/blocks/editable/editable-leaf.ts':
				'a modified Backspace is a shortcut, not the plain key the leaf handles',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'a modified Enter or arrow is a shortcut, not the plain key the cell handles',
			'src/lib/components/menu/BlockMenu.svelte':
				'a modified key is left to the editor, not read as menu navigation',
			'src/lib/plugins/mermaid/MermaidBlock.svelte':
				'Ctrl/Cmd+wheel zooms the diagram and Mod+Enter commits its edit: shortcuts, not a click that follows',
			'src/lib/selection/dead-space-caret.ts': 'a modified click places no caret in empty space',
			'src/lib/selection/multi-click.ts': 'a modified press is not a multi-click select'
		},
		reaches: [SOURCE.editorRootGestures, SOURCE.footnoteReference],
		reason:
			'whether a click follows a link or a widget depends on the mode and the host’s `linkClick`, so a hand Ctrl/Cmd read answers for one host only: call `EditorContext.isActivationClick(e)` in a block, the `isActivationClick` prop in an inline widget, or `EditorPolicies.activationClick` inside the editor',
		hits: [
			at(
				'src/routes/test/plugins/x/Link.svelte',
				"<a onclick={(e) => { if (e.ctrlKey || e.metaKey || mode === 'reading') go(); }}>x</a>"
			),
			'function onClick(e: MouseEvent) { if (e.metaKey || e.ctrlKey) follow(); }',
			"function onClick(e: MouseEvent) { if (!e.ctrlKey && !e.metaKey && mode !== 'reading') return; }"
		],
		misses: [
			at(
				'src/routes/test/plugins/x/Link.svelte',
				'<a onclick={(e) => { if (isActivationClick(e)) go(); }}>x</a>'
			),
			'function onClick(e: MouseEvent) { if (e.shiftKey) extend(); }',
			'const plainClickJumps = isActivationClick({ ctrlKey: false, metaKey: false });'
		]
	},
	{
		id: 'G4.146 a release asks the press tracker whether it ended a drag',
		matches: /Math\.abs\([^)]*\bclient[XY]\b/,
		allowed: {
			'src/lib/activation-click.ts': 'the press tracker itself',
			'src/lib/components/image/ImageResizeHandles.svelte':
				'a dev warning sizing a resize gesture, not a click told from a drag'
		},
		reason:
			'a second press record or threshold drifts from the first, so one route calls a release a click and another calls it a drag: ask `EditorServices.presses.travelled(e)`',
		hits: [
			'if (Math.abs(e.clientX - press.x) > 3 || Math.abs(e.clientY - press.y) > 3) return;',
			'const dragged = Math.abs(e.clientY - down.y) > SLOP;'
		],
		misses: ['if (presses.travelled(e)) return;', 'const dx = Math.abs(width - startWidth);']
	},
	{
		id: 'G4.229 a key moves a selection end through keyboard-extend, which shows it',
		matches: /\.(?:extendFocus|enterCrossBlock|extendSelectionToRaw)\s*\(/,
		allowed: {
			[SOURCE.keyboardExtend]:
				'every key that moves an end, which shows it; also the select-all and Shift+click writes',
			'src/lib/selection/drag-pointer.ts': 'a pointer drag, whose end is under the pointer',
			'src/lib/components/blocks/table/cell-pointer.ts':
				'a pointer drag across cells, whose end is under the pointer',
			'src/lib/selection/native-bridge.ts': 'the restore, whose landing shows the caret itself',
			'src/lib/selection/cross-block/range-indent.ts':
				'an indent keeping a block held whole, which moves no end',
			'src/lib/testing/kind-conformance.ts': 'the conformance kit, which sets up a range'
		},
		reaches: [SOURCE.keyboardExtend],
		reason:
			'an end a key moves has to land on screen through the scroll owner: write it through `selection/keyboard-extend.ts`, whose writes call `showSelectionEnd`',
		hits: [
			'selection.extendFocus(cellPoint(path, 3));',
			'ctx.selection.enterCrossBlock(anchor, focus);',
			'deps.caretWriter.extendSelectionToRaw(el, bounds.start);',
			'selection.extendFocus (point);'
		],
		misses: [
			'extendWithinBlock(deps.extend, el, bounds.start);',
			'extendFocusToNextBlock(ctx, el, path);',
			'extendFocus(point: SelectionEndpoint): void;'
		]
	},
	{
		id: 'G4.225 the drag session hears a release before anything else on the page',
		// Any phase counts, since a capture flag held in a variable is invisible to a scan.
		matches:
			/(?:\b(?:window|defaultView|globalThis|self)\b[^;]*?\.|(?<![\w$.]))addEventListener\(\s*['"]pointer(?:up|cancel)['"]|\b(?:onRoot|on)\(\s*(?:window|globalThis|self|[\w.?]*defaultView[^,]*),\s*['"]pointer(?:up|cancel)['"]|<svelte:window[^>]*\bonpointer(?:up|cancel)/,
		allowed: {
			'src/lib/selection/pointer-session.ts': 'the drag session, which resolves the release first'
		},
		reason:
			'a window-level release listener can run before the drag session and change the page (show a popover under the pointer) before the drag hit-tests its last point: listen on the document or below',
		hits: [
			"window.addEventListener('pointerup', onUp, true);",
			"window.addEventListener('pointerup', onUp, opts);",
			"doc.defaultView?.addEventListener('pointercancel', onUp, { capture: true });",
			"globalThis.addEventListener('pointerup', onUp, true);",
			"addEventListener('pointerup', onUp, true);",
			"onRoot(window, 'pointerup', endPress, { capture: true }),",
			"on(window, 'pointercancel', endPress);",
			'<svelte:window onpointerupcapture={onUp} />',
			'<svelte:window onpointerup={onUp} />'
		],
		misses: [
			"document.addEventListener('pointerup', up, true);",
			"root.addEventListener('pointerup', armFrame, on);",
			"window.removeEventListener('pointerup', onUp, true);",
			"window.addEventListener('pointermove', onMove, true);",
			"onRoot(doc, 'pointerup', endPress, { capture: true }),",
			"onRoot(doc.defaultView ?? window, 'blur', endPress)"
		]
	},
	{
		id: 'G4.234 a delete input type is named only where the editor decides deletes',
		matches:
			/['"`]delete(?:Content|Word|SoftLine|HardLine|EntireSoftLine|By|Composition)\w*['"`]|\.startsWith\(\s*['"`]delete['"`]|\/\^delete/,
		allowed: {
			[SOURCE.deleteExtent]:
				'the one list of delete input types, which says what each takes and which the editor writes'
		},
		reaches: [SOURCE.deleteExtent],
		reason:
			'a branch on a delete input type is a second opinion on which deletes the editor writes: ask `caret/delete-extent.ts` (`decidedDelete`, `isDeleteInput`, `isMoveDelete`)',
		hits: [
			"if (e.inputType !== 'deleteContentBackward') return false;",
			"case 'deleteWordForward':",
			"return e.inputType.startsWith('delete') ? '' : e.data;",
			'return /^delete(?!By)/.test(e.inputType);',
			'const cut = inputType === "deleteByCut";'
		],
		misses: [
			'if (!isCharacterBackspace(e.inputType)) return false;',
			"blockEdit.deleteBlock(index, 'Backspace');",
			"case 'table.deleteRow':",
			"['deleteRow', 'Delete row', canDeleteRow(rowIdx, rowCount)]"
		]
	},
	{
		id: 'G4.239 no block runs a merge by its id',
		// A keymap row (`command:`) binds a merge and a handler (`case`) answers one; neither runs it.
		matches: /(?<!command:\s*|case\s+)['"`]block\.merge(?:Prev|Next)['"`]/,
		allowed: {
			[SOURCE.commands]: 'the list of built-in command ids'
		},
		reaches: [SOURCE.commands],
		reason:
			'a delete at a block’s edge runs what plain Backspace or Delete binds, through `collapsed-delete.ts` and the keymap; a merge run by its id skips the host’s `keybindings`',
		hits: [
			"void runCommand(direction === 'backward' ? 'block.mergePrev' : 'block.mergeNext');",
			"editor.runCommand('block.mergeNext');"
		],
		misses: [
			"{ chord: 'Backspace', command: 'block.mergePrev' },",
			"case 'block.mergeNext':",
			'if (target) dispatchKeyCommand(key, target, deps.commands);'
		]
	},
	{
		id: 'G4.234 an editable block hears beforeinput through its editable surface',
		matches:
			/addEventListener\(\s*['"]beforeinput['"]|\bonbeforeinput(?:capture)?\s*[=:]\s*\{?\s*(?!editableSurface\.onBeforeInput\b|\(\w+:\s*InputEvent\)\s*=>\s*void)[\w$(]|\[[^\]]*['"]beforeinput['"][^\]]*\]\s*\.(?:map|forEach)\(|\bon(?:Root)?\([^)]*['"]beforeinput['"]/,
		allowed: {
			'src/lib/components/menu/InlineMenuHost.svelte':
				'a capture listener on the root that takes the inline menu’s baseline and writes nothing',
			'src/lib/components/editor-root/listeners.ts':
				'a capture listener on the root that ends the undo step and writes nothing',
			'src/lib/components/GapCaret.svelte':
				'the gap caret, which is no block’s text and refuses every input but its one character',
			'src/lib/editor-actions/whole-block-focus-surface.ts':
				'the proxy a block focused whole types into, which refuses every input but its one character'
		},
		reason:
			'every editable block hears `beforeinput` through `editableSurface.onBeforeInput`, whose last step decides a collapsed delete (`collapsed-delete.ts`); a handler bound around it lets the browser delete on its own. A binding through an event-name variable is invisible here',
		hits: [
			"root.addEventListener('beforeinput', onBeforeInput, true);",
			'<div contenteditable onbeforeinput={onBeforeInput}></div>',
			'onbeforeinput: handleInput,',
			'onbeforeinput: (e) => handle(e),',
			"const removers = ['keydown', 'beforeinput'].map((type) => onRoot(win, type, handler));",
			"onRoot(win, 'beforeinput', handler, { capture: true })"
		],
		misses: [
			'onbeforeinput={editableSurface.onBeforeInput}',
			'onbeforeinput: editableSurface.onBeforeInput,',
			'onbeforeinput: (e: InputEvent) => void;',
			"if (e.type === 'beforeinput') return true;",
			"root.removeEventListener('beforeinput', onBeforeInput, true);"
		]
	}
];

// ── G4.89, G4.90 one in-leaf range replace ─────────────────────────────────

/** The directories and files holding live editing paths; a fenced code body has no inline constructs. */
const SPLICE_PATHS = [
	SOURCE_DIR.components,
	SOURCE.blockContentSelector,
	SOURCE.blockElLookup,
	SOURCE_DIR.selection,
	SOURCE_DIR.editorActions,
	SOURCE_DIR.treeOperations,
	SOURCE_DIR.inline,
	SOURCE_DIR.inlineMenu
];

const SPLICE_PROBE = `${SOURCE_DIR.textBlock}probe.ts`;

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
			under(...SPLICE_PATHS)(file) && !file.relPath.startsWith(SOURCE_DIR.codeBlock),
		matches: SAME_SOURCE_SPLICE,
		allowed: {
			'src/lib/tree-operations/leaf-range.ts': 'the in-leaf range replace itself',
			'src/lib/core/inline/live-edit/live-join.ts':
				'the join cleanup, which the range replace calls',
			'src/lib/tree-operations/structural-suffix.ts': "a split's two halves, which remove nothing",
			'src/lib/components/blocks/text/construct-edge-delete.ts':
				'the edge delete, which reads its own candidate back where it is stored',
			'src/lib/components/blocks/text/text-keydown.ts': 'a tab inserted, which deletes nothing',
			'src/lib/components/blocks/text/pending-break-keys.ts':
				'a key typed on the line a pending break opened, which deletes nothing',
			'src/lib/components/blocks/text/edge-seat.ts':
				'a typed byte probed or placed at a caret position, which deletes nothing',
			'src/lib/components/blocks/text/pending-mark-insert.ts':
				'a typed run inserted wrapped in the pending marks, which deletes nothing',
			'src/lib/components/blocks/text/next-byte.ts':
				'a probe letter inserted at the caret to read its formats, which writes nothing',
			'src/lib/components/blocks/text/delimiter-autopair.ts':
				'a delimiter inserted with its pair, or the empty pair it wrote taken back whole',
			'src/lib/components/blocks/text/auto-pair-record.ts':
				'remembers a pair the auto-pair wrote and writes nothing',
			'src/lib/components/blocks/table/TableCellBlock.svelte':
				'a `<br>` inserted at the caret, which deletes nothing',
			'src/lib/components/blocks/editable/editable-leaf.ts':
				'a shown source’s own text, where every marker is on screen',
			'src/lib/components/blocks/editable/editable-surface.ts':
				'text typed at an offset once a range is gone, which deletes nothing',
			'src/lib/components/image/image-widget-editing.ts':
				'an image replaced by its own edited bytes, one whole construct for another',
			'src/lib/core/inline/index.ts': 'a hard break inserted, which deletes nothing',
			'src/lib/core/inline/format-toggle.ts':
				'the format toggle writes delimiters and checks its candidate against the screen',
			'src/lib/core/inline/link-source-bytes.ts':
				'the link writer rewrites one whole link and checks its candidate against the screen',
			'src/lib/inline-menu/inline-menu-session.ts': 'compares two texts and writes nothing',
			'src/lib/selection/cross-block/range-delete/range-delete.ts':
				'the range delete’s own join, a known gap until it calls `joinLeaves` (T18 slice 5)',
			'src/lib/selection/cross-block/range-replace.ts':
				'a key typed over a range into a block with no typing write lands after its removal, a known gap until the text rides into the join (T18 slice 5)'
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
			at(`${SOURCE_DIR.codeBlock}probe.ts`, 'const out = raw.slice(0, a) + raw.slice(b);')
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
			'src/lib/windowing/scroll-owner.ts':
				'the one writer, which asks who owns the position before each write',
			'src/lib/windowing/scrollport.ts':
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
		reaches: [SOURCE.scrollOwner],
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
			'src/lib/windowing/scroll-owner.ts': 'the owner, which works out where from the list tree',
			'src/lib/windowing/list-windowing.svelte.ts':
				'`revealChild`, the descent’s one scroll, naming the block and never a position'
		},
		reason:
			'a list that scrolls outside its descent corrects behind the measure round’s back: write heights and let the round keep the page still, or declare why here',
		reaches: [SOURCE.listWindowing],
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
		reaches: [SOURCE.nativeBridge],
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
	'src/lib/windowing/list-tree.ts :: descend :: heldBlock': {
		calls: 1,
		reason: 'the one pick of the block a measure round keeps still, level by level'
	},
	'src/lib/windowing/list-tree.ts :: movedSince :: held move': {
		calls: 1,
		reason: 'the one distance the round corrects by, read through the same walk as `resolve`'
	},
	'src/lib/components/editor-root/geometry.ts :: <module> :: compensate': {
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
	id: 'G4.93 only `steady-block.ts` makes a held block or the distance it moved',
	matches: /\bas\s+(?:HeldBlock|HeldDelta)\b/,
	allowed: {
		'src/lib/windowing/steady-block.ts':
			'`heldBlock` and `heldDelta`, the one pick and the one distance'
	},
	reason:
		'a cast to a held block or a held distance picks the block a list keeps still somewhere other than `heldBlock`: call `heldBlock` and `heldDelta` instead',
	reaches: [SOURCE.steadyBlock],
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
	'src/lib/windowing/list-windowing.svelte.ts :: applyMeasured :: table write': {
		calls: 1,
		reason:
			'the one write of a child’s height into its list’s table, only while that index still holds that id'
	},
	'src/lib/windowing/list-windowing.svelte.ts :: applyMeasured :: cache write': {
		calls: 1,
		reason: 'records the height under the id the child passed'
	},
	'src/lib/windowing/list-windowing.svelte.ts :: applyHeight :: applyMeasured': {
		calls: 1,
		reason: 'the batched pass applies each registered child through the one write'
	},
	'src/lib/windowing/use-container-windowing.svelte.ts :: register :: registration': {
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
		'src/lib/windowing/use-container-windowing.svelte.ts': 'every list provides the channel',
		'src/lib/windowing/use-measured-child.svelte.ts':
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

/** A mark's handlers are plugin code: called from one place per gesture, each through the
 *  engine's guarded runner, so a new route cannot skip the hover lifecycle or the error event. */
const MARK_HANDLER_CALLERS: ManifestRule = {
	id: 'G4.163 a mark’s interactive handlers are called only by the hover lifecycle, the activate command and the overlay’s click',
	matches: /\binteractive\s*\??\.\s*on(?:Click|Hover|Activate)\s*(?:\?\.)?\s*\(/,
	declared: {
		'src/lib/decorations/mark-hover.ts':
			'`onHover`, started and ended by the one lifecycle keyed on the decoration',
		'src/lib/decorations/mark-activation.ts':
			'`onActivate`, run by `decorations.activateAtCaret` on the mark the precedence rule picks',
		'src/lib/components/overlays/DecorationOverlay.svelte':
			'`onClick`, on the rect the click landed on'
	},
	reason:
		'a mark handler called from anywhere else skips the hover lifecycle’s one-end rule or the `error` event: route the gesture through `DecorationEngine.markHover` or `runMarkHandler`',
	reaches: [SOURCE.markHover],
	hits: [
		'dec.interactive?.onHover?.(dec, null);',
		'mark.interactive.onClick(mark, ev);',
		'd.interactive?.onActivate(d, { anchor });'
	],
	misses: [
		'if (dec.interactive?.onHover) start();',
		'const onActivate = range.onActivate;\nonActivate();',
		'// `interactive.onClick(dec, ev)` runs on a click.\nconst a = 1;'
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

const LAYOUT_HOME = SOURCE.layoutState;

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
			"import { createHeightOracle } from '../windowing/height-estimator';",
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
	'src/lib/windowing/scroll-owner.ts :: writeScroll :: absolute': {
		calls: 1,
		reason: 'every owner write but the round’s, once the round is closed'
	},
	'src/lib/windowing/scroll-owner.ts :: writeScroll :: relative': {
		calls: 1,
		reason: 'the same write, by a distance'
	},
	'src/lib/windowing/scroll-owner.ts :: writeScroll :: into view': {
		calls: 1,
		reason: 'a placement’s scroll, once the round is closed'
	},
	'src/lib/windowing/scroll-owner.ts :: closeRound :: absolute': {
		calls: 1,
		reason: 'a held placement put back as the round closes'
	},
	'src/lib/windowing/scroll-owner.ts :: closeRound :: relative': {
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
					.filter((file) => file.relPath === SOURCE.scrollOwner)
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

// ── G4.229 inside the extend module, which functions write an end ────────────

const KEYBOARD_END_WRITES: Record<string, { calls: number; reason: string }> = {
	'src/lib/selection/keyboard-extend.ts :: moveFocusTo :: focus': {
		calls: 1,
		reason: 'every key that moves a focus, which shows it or restores the fold'
	},
	'src/lib/selection/keyboard-extend.ts :: enterCrossBlockFromKeyboard :: pair': {
		calls: 1,
		reason: 'a pair at the caret, whose focus `moveFocusTo` moves next'
	},
	'src/lib/selection/keyboard-extend.ts :: extendFromCell :: pair': {
		calls: 1,
		reason: 'a pair at the cell, whose focus `moveFocusTo` moves next'
	},
	'src/lib/selection/keyboard-extend.ts :: extendWithinBlock :: in block': {
		calls: 1,
		reason: 'a key inside one block, which shows what it wrote'
	},
	'src/lib/selection/keyboard-extend.ts :: selectWholeDocument :: pair': {
		calls: 1,
		reason: 'the second Mod+A, whose ends are the document edges'
	},
	'src/lib/selection/keyboard-extend.ts :: handleShiftClick :: focus': {
		calls: 1,
		reason: 'a Shift+click, whose end is under the pointer'
	},
	'src/lib/selection/keyboard-extend.ts :: enterRangeAtPress :: pair': {
		calls: 1,
		reason: 'a Shift+click, whose end is under the pointer'
	}
};

const END_WRITE_KINDS: CallKind[] = [
	{ kind: 'focus', callee: 'extendFocus', counts: () => true },
	{ kind: 'pair', callee: 'enterCrossBlock', counts: () => true },
	{ kind: 'in block', callee: 'extendSelectionToRaw', counts: () => true }
];

function describeKeyboardEndWrites(sources: SourceFile[]): void {
	describe('G4.229 inside `keyboard-extend.ts`, only the declared functions write an end', () => {
		it('the writes are exactly the declared ones', () => {
			const found = Object.fromEntries(
				sources
					.filter((file) => file.relPath === SOURCE.keyboardExtend)
					.flatMap((file) => [...callSites(file, END_WRITE_KINDS)])
			);
			const declared = Object.fromEntries(
				Object.entries(KEYBOARD_END_WRITES).map(([site, { calls }]) => [site, calls])
			);
			expect(
				found,
				'a key that writes its end here directly skips the show: go through `moveFocusTo` or `extendWithinBlock`, or declare it here with why'
			).toEqual(declared);
		});
	});
}

// ── G4.94 the editor's own selection has one store and three writers ─────────

const SELECTION_WRITERS: ManifestRule[] = [
	{
		id: 'G4.94 a gap caret or a widget is selected only through `place-caret.ts`',
		matches: /\.(?:setGapCaret|selectWidget)\s*\(/,
		declared: {
			'src/lib/selection/place-caret.ts':
				'`placeGapCaret` and `selectWidgetWhole`, which end the browser’s own range in the same batch'
		},
		reason:
			'a gap caret or a widget selected outside `selection/place-caret.ts` can leave a browser caret live beside it: call `placeGapCaret` or `selectWidgetWhole`',
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

const ROGUE_WRITER = `${SOURCE_DIR.blocks}x/rogue-writer.ts`;

const TYPED_WRITE_ASKS: ManifestRule[] = [
	{
		id: 'G4.101 only the surface write names a typed kind change or completes a typed line',
		population: under(
			SOURCE_DIR.components,
			SOURCE_DIR.browser,
			SOURCE_DIR.caret,
			SOURCE_DIR.selection
		),
		matches: /\.(?:afterTypedWrite|completeLineOnType)\s*\(/,
		declared: {
			'src/lib/components/blocks/editable/surface-write.ts':
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

// ── G4.251 the bundled reveal blocks still drawn by Svelte ─────────────────

const REVEAL_BLOCKS_IN_SVELTE: ManifestRule[] = [
	{
		id: 'G4.251 the bundled blocks that build a render-primary leaf in Svelte are listed',
		population: under(SOURCE_DIR.plugins),
		matches: /\bmode:\s*['"]render-primary['"]/,
		declared: {
			[SOURCE.latexBlockMath]: 'block math, with its layout toggle and live preview',
			'src/lib/plugins/toc/TocBlock.svelte': 'the outline, whose list follows the headings',
			'src/lib/plugins/parrot/ParrotBlock.svelte': 'the plugin guide’s quickstart block'
		},
		reason:
			'a bundled block that shows a rendered view until clicked can be a `defineBlockView({ surface: "render-primary" })` view; this list is where moving them starts, and it guards nothing inside a listed file',
		hits: [at('src/lib/plugins/x/XBlock.svelte', "mode: 'render-primary',")],
		misses: [
			at(
				'src/lib/plugins/x/x-kind.ts',
				"focus: { mode: 'implemented', via: 'render-primary reveal' },"
			),
			at('src/lib/plugins/x/x-view.ts', "surface: 'render-primary',")
		]
	}
];

// ── G4.108 one replace for every destructive gesture over a range ──────────

const ROGUE_RANGE_ROUTE = `${SOURCE_DIR.crossBlock}rogue.ts`;
const RANGE_REPLACE_HOME = SOURCE.rangeReplace;
/** `range-delete.ts` and its `range-delete-*.ts` siblings, which define the removals. */
const RANGE_DELETE_FAMILY = SOURCE.rangeDelete.slice(0, -'.ts'.length);

const RANGE_REPLACE: ManifestRule[] = [
	{
		id: 'G4.108 only the range replace removes a live range',
		population: notUnder(RANGE_DELETE_FAMILY),
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
		population: under(SOURCE_DIR.crossBlock),
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

const ROGUE_INDENT_ROUTE = `${SOURCE_DIR.blocks}rogue.ts`;
const ITEM_MOVES_HOME = SOURCE.listItemMoves;

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
		population: notUnder(SOURCE_DIR.schema),
		matches: /(?<![\w.])(?:dispatchKindCommand|dispatchKeyCommand|commandForKey)\s*\(/,
		declared: {
			'src/lib/editor-actions/container-block-component.ts':
				'the container dispatch, which leaves a key a live range owns to the range, whose handler claims it only after an await',
			'src/lib/components/blocks/editable/surface-wiring.svelte.ts':
				'a leaf’s own chords, which the leaf runs once the range’s handler has passed on the key',
			'src/lib/components/blocks/editable/editable-surface.ts':
				'a delete at a leaf’s edge, which runs what plain Backspace or Delete binds there',
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
		population: under(SOURCE_DIR.library),
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

// ── G4.131 a block syntax's bytes are read and written in its own module only ──

const MATH_SHAPE_HOME = SOURCE.mathShape;
const ROGUE_MATH_READER = `${SOURCE_DIR.latexPlugin}rogue.ts`;
// The fence constant, or a string opening or closing on the fence: `$$` read or written by hand.
const DOLLAR_FENCE = String.raw`\b(?:BLOCK_FENCE|FENCE)\b|['"\x60]\$\$|\$\$['"\x60]`;
// A regex for the fence spells it escaped: `\$\$` in a literal, `\\$\\$` in a string.
const ESCAPED_FENCE = String.raw`\\\$\\\$|\\\\\$\\\\\$`;
// A source split into lines, or a fence test handed a line read off one: a closer search by hand.
const MATH_LINE_SEARCH = String.raw`\b(?:displayLines|firstDisplayLine|splitLines)\s*\(|\b(?:isMathFenceLine|opensMathBlock)\s*\(\s*[\w$.[\]]*\.text\s*\)`;

const TABLE_LINE_HOME = SOURCE.tableLine;
const ROGUE_TABLE_WRITER = `${SOURCE_DIR.schema}rogue.ts`;
// A row edge spelled as a string: a padded pipe (`'| '`, `' |'`), or a bare one joined on with `+`.
const PADDED_PIPE = String.raw`['"\x60]\| ['"\x60]|['"\x60] \|['"\x60]|['"\x60]\|['"\x60]\s*\+|\+\s*['"\x60]\|['"\x60]`;
// A template padding an interpolation with a pipe (`| ${cell}`, `${cell} |`), or ending on one.
const TEMPLATE_ROW = String.raw`\| \$\{|\$\{[^}\x60]*\} \||\}\|\x60`;
// A row's edge pipe read by hand: a regex anchored on it, a string test, or an index read.
const EDGE_PIPE_READ = String.raw`/\^(?:\\s|\[[^\]\n]*\]| )?[*+?]?\\\||\\\|(?:\\s|\[[^\]\n]*\]| )?[*+?]?\$/|(?:startsWith|endsWith)\(\s*['"\x60]\|['"\x60]\s*\)|(?:\[\s*0\s*\]|\[[^\]\n]*length\s*-\s*1\s*\]|\.at\(\s*-1\s*\))\s*[!=]==?\s*['"\x60]\|['"\x60]`;
// A header's cell count compared with a delimiter's: the table opening test written again.
const OPENING_ARITY =
	/\.length\s*[!=]==?\s*[\w.?]*columnCount\b|\bcolumnCount\s*[!=]==?\s*[\w.?]*\.length\b/;
// A delimiter cell spelled as a string; a comparison or search with `---` is a divider's.
const DELIMITER_CELL = String.raw`(?<!(?:[=!]==?|(?:startsWith|endsWith|includes|indexOf)\()\s*)['"\x60]:?-{3,}:?['"\x60]`;

/** One row per block syntax: the module its bytes are read and written in, and what a copy looks like. */
const SYNTAX_MODULES: FileRule[] = [
	{
		id: 'G4.131 a `$$` block’s opener, body and closer are read and written in `math-shape.ts` only',
		population: under(SOURCE_DIR.latexPlugin),
		matches: new RegExp(`${DOLLAR_FENCE}|${ESCAPED_FENCE}|${MATH_LINE_SEARCH}`),
		allowed: {
			[MATH_SHAPE_HOME]:
				'the closer search, the split and the block lines the parser, the write rule, the painter and the completer all ask'
		},
		reaches: [MATH_SHAPE_HOME],
		reason:
			'a second copy of the `$$` shape drifts from the first, so the painted source, the bytes its blur writes and a reload stop agreeing on one edit: ask `readMathSource`, `mathCloserLine` over a line array, or `mathBlockLines` to write a block',
		hits: [
			at(ROGUE_MATH_READER, "if (text.startsWith('$$')) return null;"),
			at(ROGUE_MATH_READER, 'return line.text === BLOCK_FENCE;'),
			at(ROGUE_MATH_READER, 'if (inner.endsWith(FENCE)) inner = inner.slice(0, -2);'),
			at(ROGUE_MATH_READER, "if (text.indexOf('$$') === 0) return null;"),
			at(ROGUE_MATH_READER, "return text.lastIndexOf('$$') === text.length - 2;"),
			at(ROGUE_MATH_READER, 'if (line.includes(BLOCK_FENCE)) return null;'),
			at(ROGUE_MATH_READER, 'if (/^\\$\\$/.test(text)) return null;'),
			at(ROGUE_MATH_READER, "const opener = new RegExp('^\\\\$\\\\$');"),
			at(ROGUE_MATH_READER, 'while (i < ctx.end && !isMathFenceLine(ctx.lines[i].text)) i++;'),
			at(ROGUE_MATH_READER, 'return rest.some((line) => isMathFenceLine(line.text));'),
			at(ROGUE_MATH_READER, 'const [openerLine] = displayLines(opener);'),
			at(ROGUE_MATH_READER, "return { lines: [BLOCK_FENCE, '', BLOCK_FENCE] };"),
			at(ROGUE_MATH_READER, "registerInsertEntry({ markdown: '$$\\n\\n$$\\n' });"),
			at(ROGUE_MATH_READER, 'const block = `$$${body}$$`;')
		],
		misses: [
			at(ROGUE_MATH_READER, "return { lines: mathBlockLines(''), caret };"),
			at(
				ROGUE_MATH_READER,
				"registerInsertEntry({ markdown: `${mathBlockLines('').join('\\n')}\\n` });"
			),
			at(ROGUE_MATH_READER, 'if (!isMathFenceLine(trimWhitespace(line))) return null;'),
			at(ROGUE_MATH_READER, 'const closer = mathCloserLine(ctx.lines, ctx.index, ctx.end);'),
			at(ROGUE_MATH_READER, "if (opener === '$') return null;"),
			at(ROGUE_MATH_READER, "const price = '$' + amount;"),
			at('src/lib/plugins/mermaid/x.ts', "if (text.startsWith('$$')) return null;")
		]
	},
	{
		id: 'G4.131 a table row’s pipes are read and written in `table-line.ts` only',
		population: under(SOURCE_DIR.library),
		matches: new RegExp(`${PADDED_PIPE}|${TEMPLATE_ROW}|${EDGE_PIPE_READ}|${DELIMITER_CELL}`),
		allowed: {
			[TABLE_LINE_HOME]:
				'the row reader, and the row, delimiter, new-table and in-place writers the rebuild, the Enter completer, the copy, the grid paste and the insert menu all call'
		},
		reaches: [TABLE_LINE_HOME],
		reason:
			'a second spelling of a table row drifts from the first, so a new table, a copied rectangle, a pasted grid and a rebuilt row stop agreeing on bytes: write a row with `tableRowLine`, `tableDelimiterLine`, `newTableLines` or `spliceCells`, and read one with `rowCellSpans`, `opensOnPipe`, `wrappedInPipes` or `boundaryPipeAt`',
		hits: [
			at(ROGUE_TABLE_WRITER, "const plain = '| ' + cells.join(' | ') + ' |';"),
			at(ROGUE_TABLE_WRITER, "return line + ' |';"),
			at(
				ROGUE_TABLE_WRITER,
				'const line = (cell: string) => `|${` ${cell} |`.repeat(columns)}\\n`;'
			),
			at(ROGUE_TABLE_WRITER, "const row = `| ${cells.join(' | ')} |`;"),
			at(ROGUE_TABLE_WRITER, "return [header, cells.map(() => '---'), empty];"),
			at(ROGUE_TABLE_WRITER, "case 'center': return ':---:';"),
			at(ROGUE_TABLE_WRITER, "return '|' + cells.map((c) => ' ' + c + ' ').join('|') + '|';"),
			at(ROGUE_TABLE_WRITER, "const row = '|' + cells.join(' | ') + '|';"),
			at(ROGUE_TABLE_WRITER, "const row = `|${cells.map((c) => ` ${c} `).join('|')}|`;"),
			at(ROGUE_TABLE_WRITER, 'if (!lines.every((l) => /^\\|.*\\|$/.test(l))) return null;'),
			at(ROGUE_TABLE_WRITER, 'const opens = /^[ \\t]*\\|/.test(line);'),
			at(ROGUE_TABLE_WRITER, "if (!trimWhitespace(line).startsWith('|')) return null;"),
			at(ROGUE_TABLE_WRITER, "if (trimWhitespace(line)[0] !== '|') return null;"),
			at(ROGUE_TABLE_WRITER, "return line.trimEnd().at(-1) === '|';"),
			at(ROGUE_TABLE_WRITER, "return t[t.length - 1] === '|';"),
			at(ROGUE_TABLE_WRITER, 'const opens = /^ *\\|/.test(line);'),
			at(ROGUE_TABLE_WRITER, 'const closes = /\\|[ \\t]*$/.test(line);')
		],
		misses: [
			at(ROGUE_TABLE_WRITER, 'return tableRowLine(cells);'),
			at(ROGUE_TABLE_WRITER, 'const lines = newTableLines(header, rows - 1);'),
			at(ROGUE_TABLE_WRITER, 'return `|${width}x${height}`;'),
			at(ROGUE_TABLE_WRITER, 'const key = `${version}|${start}|${end}`;'),
			at(ROGUE_TABLE_WRITER, "if (rowText[lo] === '|') lo++;"),
			at(ROGUE_TABLE_WRITER, "if (rowText[hi - 1] === '|') hi--;"),
			at(ROGUE_TABLE_WRITER, "return pieces.join('|');"),
			at(ROGUE_TABLE_WRITER, '`"${kind}" onEdge is one of ${ON_EDGE_POLICIES.join(\' | \')}`;'),
			at(ROGUE_TABLE_WRITER, "entry('divider', 'Divider', 'minus', [], '---\\n');"),
			at(ROGUE_TABLE_WRITER, "if (line === '---') return 'front matter';"),
			at(ROGUE_TABLE_WRITER, "if (text.startsWith('---')) return null;"),
			at(ROGUE_TABLE_WRITER, 'const name = /^\\w+/.exec(text);'),
			"const plain = '| ' + cells.join(' | ') + ' |';"
		]
	},
	{
		id: 'G4.131 whether two lines open a table is decided in `matchTableOpening` only',
		population: under(SOURCE_DIR.library),
		matches: OPENING_ARITY,
		allowed: {
			[SOURCE.tableParser]: '`matchTableOpening`, which the parser and the grid paste both ask'
		},
		reaches: [SOURCE.tableParser],
		reason:
			'a second test for whether two lines open a table drifts from the parser’s, so a paste and a reload disagree on what is a table: ask `matchTableOpening`',
		hits: [
			at(
				ROGUE_TABLE_WRITER,
				'if (delimiter && header && header.length === delimiter.columnCount) {'
			),
			at(ROGUE_TABLE_WRITER, 'return delim?.columnCount !== cells.length ? null : delim;')
		],
		misses: [
			at(ROGUE_TABLE_WRITER, 'const delimiter = matchTableOpening(lines[0], lines[1]);'),
			at(ROGUE_TABLE_WRITER, 'if (row.children.length < meta.columnCount) pad(row);'),
			'if (header.length === delimiter.columnCount) return delimiter;'
		]
	}
];

// ── G4.114 one paint decision for a block under a range ─────────────────────

const ROGUE_PAINTER = `${SOURCE_DIR.components}RoguePaint.svelte`;
const COVERAGE_FIELD = String.raw`\b(?:wholeRoots|coveredWhole|startEdge|endEdge|startCells|endCells)\b`;
const END_PATH = (end: string) => String.raw`[\w.?]*\b${end}\??\.path\s*`;
const ENDS_COMPARED = String.raw`pathsEqual\(\s*(?:${END_PATH('start')},\s*${END_PATH('end')}|${END_PATH('end')},\s*${END_PATH('start')})\)`;

const RANGE_PAINT: FileRule = {
	id: 'G4.114 how a block paints under a range is decided in the selection model only',
	population: notUnder(SOURCE_DIR.selection),
	// A dotted read, or an object pattern naming a field, assigned or typed as the coverage; or a
	// range's two ends compared, which is `rangeSpansBlocks` worked out again.
	matches: new RegExp(
		String.raw`\.(?:coveredRootHolding|rootHolding)\s*\(|\.${COVERAGE_FIELD}|\{[^{}]*${COVERAGE_FIELD}[^{}]*\}\s*(?:=(?!=)|:\s*RangeCoverage\b)|${ENDS_COMPARED}`
	),
	reaches: [SOURCE.selectionOverlay],
	reason:
		'a painter that reads the coverage itself, or compares the range ends, keeps its own copy of which block a range covers whole or whether it spans blocks, and the painters disagree on the shape: ask `classifyBlockForSelection`, `blockPaintsWholeBox` or `rangeSpansBlocks`',
	hits: [
		at(ROGUE_PAINTER, 'const boxed = coverage.rootHolding(path) !== null;'),
		at(ROGUE_PAINTER, 'if (coverage.coveredRootHolding(path)) return;'),
		at(ROGUE_PAINTER, 'const roots = live.wholeRoots;'),
		at(ROGUE_PAINTER, 'const from = coverage.startEdge?.offset ?? 0;'),
		at(ROGUE_PAINTER, 'const run = coverage.endCells;'),
		at(ROGUE_PAINTER, 'const { wholeRoots, startEdge } = coverage;'),
		at(ROGUE_PAINTER, 'const {\n\tstartCells,\n\tcoveredWhole\n} = live;'),
		at(ROGUE_PAINTER, 'function paint({ endEdge }: RangeCoverage): void {}'),
		at(ROGUE_PAINTER, 'const across = !pathsEqual(start.path, end.path);'),
		at(ROGUE_PAINTER, 'if (pathsEqual(selection.end?.path, selection.start?.path)) return;')
	],
	misses: [
		at(ROGUE_PAINTER, 'const box = blockPaintsWholeBox(path, coverage, null);'),
		at(ROGUE_PAINTER, 'const grid = rangeCoverage()?.grid;'),
		at(ROGUE_PAINTER, 'const { start, end } = coverage.range;'),
		at(ROGUE_PAINTER, 'if (a == { startEdge }) return;'),
		at(ROGUE_PAINTER, 'const across = rangeSpansBlocks(coverage);'),
		at(ROGUE_PAINTER, 'const collapsed = pathsEqual(live.anchor.path, live.focus.path);')
	]
};

// ── G4.123 a dissolving list item's children leave it under the order check ──

const DISSOLVE_HOME = 'src/lib/tree-operations/list/item-partition.ts';
const ROGUE_DISSOLVE = 'src/lib/tree-operations/list/rogue.ts';
const PIECE_SPLIT = /(?<![\w.])(?<!function\s+)itemPiecesInOrder\s*\(/g;

/** Whether the file splits an item's children anywhere outside a `keepingListOrder(…)` call. */
function splitsOutsideOrderCheck(file: SourceFile): boolean {
	const checked = [...file.code.matchAll(/(?<![\w.])keepingListOrder\s*\(/g)].map((call) => {
		const from = call.index + call[0].length;
		return [from, from + (balancedCall(file.code, from)?.length ?? 0)];
	});
	return [...file.code.matchAll(PIECE_SPLIT)].some(
		(split) => !checked.some(([from, to]) => split.index >= from && split.index < to)
	);
}

const ITEM_PIECES: ManifestRule[] = [
	{
		id: 'G4.123 an item’s children are split in the dissolve module only',
		matches: new RegExp(PIECE_SPLIT.source),
		declared: {
			[DISSOLVE_HOME]: '`dissolveItem`, which the first-item unwrap and the Enter exit both call'
		},
		reason:
			'a second route that splits a dissolving item’s children drifts from the first, and the two routes read the same item’s children out in different orders: call `dissolveItem`',
		hits: [at(ROGUE_DISSOLVE, 'const pieces = itemPiecesInOrder(item.children, false);')],
		misses: [
			at(ROGUE_DISSOLVE, 'const { blocks } = dissolveItem(list, 1);'),
			at(ROGUE_DISSOLVE, 'function itemPiecesInOrder(children, ordered) {}')
		]
	},
	{
		id: 'G4.123 a list is rebuilt around a dissolved item in the dissolve module only',
		population: under(SOURCE_DIR.library),
		matches: /(?<![\w.])(?<!function\s+)assembleListHalf\s*\(/,
		declared: {
			[DISSOLVE_HOME]: '`dissolveItem`, the list halves around a dissolving item',
			'src/lib/tree-operations/paste/list-break-out.ts':
				'a paste splits the list around the pasted blocks, and no item dissolves'
		},
		reason:
			'a route that dissolves an item has to rebuild the list around it, and one that does so outside `dissolveItem` splits the item’s children its own way: call `dissolveItem`',
		hits: [
			at(ROGUE_DISSOLVE, 'blocks.push(assembleListHalf(list, firstHalfItems, base));'),
			at(ROGUE_DISSOLVE, 'const half = assembleListHalf(list, secondHalfItems, start);')
		],
		misses: [
			at(ROGUE_DISSOLVE, "import { assembleListHalf } from './list-builders';"),
			at(ROGUE_DISSOLVE, 'export function assembleListHalf(template, items, start) {}')
		]
	}
];

const PIECES_UNDER_ORDER_CHECK: FileRule = {
	id: 'G4.123 an item’s children are split inside the list order check only',
	population: under(SOURCE_DIR.library),
	matches: splitsOutsideOrderCheck,
	reaches: [DISSOLVE_HOME],
	reason:
		'a split outside `keepingListOrder` can put the children out of reading order and no dev warning fires: wrap the split and the assembly in it',
	hits: [
		at(ROGUE_DISSOLVE, 'return assemble(itemPiecesInOrder(children, ordered));'),
		at(
			ROGUE_DISSOLVE,
			'keepingListOrder(read, () => blocks);\nconst pieces = itemPiecesInOrder(children, false);'
		)
	],
	misses: [
		at(
			ROGUE_DISSOLVE,
			'return keepingListOrder(\n\t() => [list],\n\t() => assemble(itemPiecesInOrder(children, ordered))\n);'
		),
		at(ROGUE_DISSOLVE, 'function itemPiecesInOrder(children, ordered) {}')
	]
};

// ── G4.125 one list of the widgets a block renders ─────────────────────────

const WIDGET_LIST_HOME = SOURCE.widgetAdjacency;
const ROGUE_WIDGET_READER = `${SOURCE_DIR.textBlock}RogueWidgets.svelte`;

const WIDGET_LIST: FileRule = {
	id: 'G4.125 a component asks which inlines are widgets only in `widget-adjacency.ts`',
	population: under(
		SOURCE_DIR.components,
		SOURCE_DIR.browser,
		SOURCE_DIR.caret,
		SOURCE_DIR.plugins
	),
	matches: /\b(?:isInlineWidget|flattenInlineWidgets)\s*\(/,
	allowed: {
		[WIDGET_LIST_HOME]:
			'`widgetsIn` itself, and the edge finders, which read the top-level list on purpose'
	},
	reaches: [WIDGET_LIST_HOME],
	reason:
		'a reader that walks the inline list itself can miss a widget a link or emphasis wraps, so a click arms one widget and the paint looks for another: ask `widgetsIn`',
	hits: [
		at(ROGUE_WIDGET_READER, 'if (!isInlineWidget(inline, node.raw, grammar)) continue;'),
		at(ROGUE_WIDGET_READER, 'const all = flattenInlineWidgets(inlines, raw, grammar);'),
		at(`${SOURCE_DIR.plugins}x/x.ts`, 'return isInlineWidget (node, raw, grammar);')
	],
	misses: [
		at(ROGUE_WIDGET_READER, 'for (const inline of widgetsIn(node, reading)) {'),
		at(ROGUE_WIDGET_READER, 'const nested = isInlineWidgetKind(kind);'),
		at(`${SOURCE_DIR.inline}transparency.ts`, 'if (isInlineWidget(inline, node.raw, grammar)) {')
	]
};

// ── G4.127 every branch on whether a DOM exists is declared ─────────────────

/** Globals a DOM provides and plain Node lacks, so a test of one answers differently per file. */
const DOM_GLOBAL = String.raw`(?:document|window|getSelection|getComputedStyle|matchMedia|requestAnimationFrame|Element|(?:HTML|SVG)\w*Element|Node|NodeFilter|Range|Selection|Text|Document|DOMParser|DOMRect|MutationObserver)\b`;

/** A test of whether a DOM exists that runs quietly without one: `typeof` on a bare DOM global,
 *  a `globalThis` read of one, or an `in globalThis` test. A bare read without `typeof` throws. */
const DOM_PRESENCE_RE = new RegExp(
	[
		String.raw`\btypeof\s+${DOM_GLOBAL}(?!\s*(?:\?\.|\.|\[))`,
		String.raw`\bglobalThis\s*(?:\?\.|\.)\s*${DOM_GLOBAL}`,
		String.raw`\bglobalThis\s*(?:\?\.)?\s*\[\s*(['"\`])${DOM_GLOBAL}\1\s*\]`,
		String.raw`(['"\`])${DOM_GLOBAL}\2\s+in\s+(?:globalThis|window|self)\b`
	].join('|'),
	'g'
);

/** Every DOM-presence test in the shipped source, keyed `path :: function` with how many it holds. */
const DOM_PRESENCE: Record<string, { branches: number; reason: string }> = {
	[`${SOURCE.devChecks} :: documentForCheck`]: {
		branches: 1,
		reason: 'where a dev check that would do more with a DOM reports that it skipped that part'
	},
	'src/lib/invariants/landing-value.ts :: readCaretWhereabouts': {
		branches: 1,
		reason:
			'with no document there is no focus or selection a landing could move, so nothing to compare'
	},
	'src/lib/editor-actions/replacement-focus.ts :: focusMovedOutsideReplacement': {
		branches: 1,
		reason: 'with no document nothing holds focus, so the caret goes back where the write left it'
	},
	'src/lib/selection/caret-landing.ts :: caretBox': {
		branches: 1,
		reason:
			'with no window there is no selection to measure, so the caret’s box is the element’s own'
	},
	'src/lib/selection/native-bridge.ts :: nativeRangeInFocusedBlock': {
		branches: 2,
		reason: 'an undo snapshot taken with no DOM keeps the caret offset alone'
	},
	'src/lib/caret/drawn-caret.svelte.ts :: caretMedia': {
		branches: 1,
		reason:
			'with no media queries (no DOM, or jsdom) there is no pointer to ask, so `auto` leaves the browser’s caret alone'
	},
	'src/lib/debug/input-recorder.ts :: environment': {
		branches: 1,
		reason: 'with no media queries (jsdom) a recording names its pointer `none`'
	},
	'src/lib/testing/mount-dom-stubs.ts :: installEditorDomStubsForTests': {
		branches: 3,
		reason: 'with no DOM there is no element, range prototype or document to fill in'
	}
};

const DOM_PRESENCE_REASON =
	'a branch on whether a DOM exists decides what a test without jsdom runs: a dev check that would do more with a DOM calls `documentForCheck` in assert.ts, which reports the skip; any other branch is declared in G4.127’s table in this file, per function, with what it does without one';

/** Each `path :: function` in `file` holding a DOM-presence test, with its count. */
function domPresenceSites(file: SourceFile): Map<string, number> {
	const found = new Map<string, number>();
	const classes = fileClasses(file);
	for (const { index, 0: read } of file.code.matchAll(DOM_PRESENCE_RE)) {
		if (classes[index + read.length - 1] !== CODE) continue;
		const key = `${file.relPath} :: ${enclosingFunction(file.code, index, classes)}`;
		found.set(key, (found.get(key) ?? 0) + 1);
	}
	return found;
}

const DOM_PRESENCE_HITS = [
	"if (typeof document === 'undefined') return null;",
	"if (typeof document == 'undefined') return null;",
	"const s = typeof window !== 'undefined' ? window.getSelection() : null;",
	"if (typeof Element !== 'undefined') {}",
	"if (typeof HTMLElement === 'function') {}",
	"if (typeof Node != 'undefined') {}",
	'const doc = globalThis.document;',
	'if (!globalThis.window) return;',
	'if (globalThis.getSelection?.()?.isCollapsed !== false) return;',
	"const doc = globalThis['document'];",
	"if ('document' in globalThis) {}"
];

const DOM_PRESENCE_MISSES = [
	"if (typeof document.elementFromPoint !== 'function') return null;",
	"if (typeof ResizeObserver !== 'function') return;",
	"if (typeof CSS === 'undefined' || typeof Worker === 'undefined') return;",
	"if (typeof TextEncoder === 'undefined' || typeof myElement === 'undefined') return;",
	'const doc = documentForCheck(name);',
	'if (!document) return entries;',
	"const note = 'typeof document === undefined';",
	'// typeof document === "undefined" outside a browser\nconst a = 1;'
];

function describeDomPresence(sources: SourceFile[]): void {
	describe('G4.127 every branch on whether a DOM exists says what runs without one', () => {
		const found = Object.fromEntries(sources.flatMap((file) => [...domPresenceSites(file)]));
		const declared = Object.fromEntries(
			Object.entries(DOM_PRESENCE).map(([site, { branches }]) => [site, branches])
		);
		const sitesOf = (code: string) => Object.fromEntries(domPresenceSites(probeFile(code)));
		const hits = DOM_PRESENCE_HITS.map((code) => ({ code, sites: sitesOf(code) }));
		const misses = DOM_PRESENCE_MISSES.map((code) => ({ code, sites: sitesOf(code) }));
		const keyed = sitesOf(
			"function a() {\n\tif (typeof document === 'undefined') return;\n\tif (typeof window === 'undefined') return;\n}\nfunction b() {\n\treturn globalThis.document;\n}"
		);

		it('the branches are exactly the declared ones, function by function', () => {
			expect(found, DOM_PRESENCE_REASON).toEqual(declared);
		});

		it('the matcher flags every hit and spares every miss', () => {
			for (const { code, sites } of hits) expect(sites, code).not.toEqual({});
			for (const { code, sites } of misses) expect(sites, code).toEqual({});
		});

		it('the census keys each branch by its function and counts it', () => {
			expect(keyed).toEqual({ 'probe.ts :: a': 2, 'probe.ts :: b': 1 });
		});
	});
}

// ── G4.130 one span for every ranged write to a code block ──────────────────

const EDIT_SPAN_HOME = SOURCE.codeFenceBoundary;
const ROGUE_CODE_WRITE = `${SOURCE_DIR.codeBlock}RogueCode.svelte`;

const FENCE_LINES_FLAG = 'fenceLinesShown';

/** Whether a file reads a fence-lines flag, or the mode check behind it, other than `fenceLinesShown`
 *  where it's derived, as the whole last argument of `editSpan`, or as an early return's last condition. */
function readsFenceLinesByHand(file: SourceFile): boolean {
	const code = file.code;
	const spanArgs: number[] = [];
	for (const call of code.matchAll(/(?<![\w.])editSpan\s*\(/g)) {
		const from = call.index + call[0].length;
		const args = balancedCall(code, from) ?? '';
		const last = callArguments(args).at(-1) ?? '';
		if (last !== FENCE_LINES_FLAG) return true;
		spanArgs.push(from + args.lastIndexOf(last));
	}
	const flagReads = [...code.matchAll(/(?<![\w.])fenceLines\w*\b/g)].filter((read) => {
		if (read[0] !== FENCE_LINES_FLAG) return true;
		const before = code.slice(0, read.index);
		const after = code.slice(read.index + read[0].length);
		const derived = /\b(?:const|let)\s+$/.test(before) && /^\s*=\s*\$derived\(/.test(after);
		const earlyReturn =
			/(?:\|\||\bif\s*\()\s*$/.test(before) && /^\s*\)\s*return(?:\s+false)?\s*;/.test(after);
		return !derived && !earlyReturn && !spanArgs.includes(read.index);
	});
	const modeChecks = [
		...code.matchAll(/(?<![\w.])(?:paintsFocusedMarkers|hidesDelimitersAtCaret)\s*\(/g)
	].filter((check) => !/\bfenceLinesShown\s*=\s*\$derived\(\s*$/.test(code.slice(0, check.index)));
	return flagReads.length > 0 || modeChecks.length > 0;
}

const CODE_EDIT_SPAN: FileRule[] = [
	{
		id: 'G4.130 a code block range is clamped to its body in `code-fence-boundary.ts` only',
		population: under(SOURCE_DIR.library),
		matches: /(?<![\w.])(?<!function\s+)clampRangeToBody\s*\(/,
		allowed: {
			[EDIT_SPAN_HOME]: '`editSpan` and the caret clamp',
			[`${SOURCE_DIR.codeBlock}code-indent.ts`]:
				'an indent keeps every fence line unindented in every mode, a line rule rather than an edit span'
		},
		reaches: [EDIT_SPAN_HOME],
		reason:
			'a route that clamps its own range keeps its own copy of the span a code block edit rewrites, and the copies drift: ask `editSpan`',
		hits: [
			at(ROGUE_CODE_WRITE, 'const span = clampRangeToBody(node, range);'),
			at(`${SOURCE_DIR.selection}x.ts`, 'return clampRangeToBody (node, { start, end });')
		],
		misses: [
			at(ROGUE_CODE_WRITE, 'const span = editSpan(node, range, fenceLinesShown);'),
			at(ROGUE_CODE_WRITE, "import { clampRangeToBody } from './code-fence-boundary';"),
			at(ROGUE_CODE_WRITE, 'export function clampRangeToBody(node, range) {}')
		]
	},
	{
		id: 'G4.130 a code block reads whether its fence lines show only for `editSpan` or an early return',
		population: under(SOURCE_DIR.codeBlock),
		matches: readsFenceLinesByHand,
		allowed: { [EDIT_SPAN_HOME]: '`editSpan` itself, which picks the span from the flag' },
		reaches: [SOURCE.codeBlockComponent, EDIT_SPAN_HOME],
		reason:
			'whether the fence lines show decides the span a code block edit rewrites, and any other read of it picks that span by hand: pass the flag to `editSpan`, or return early on it before the block takes the edit',
		hits: [
			at(ROGUE_CODE_WRITE, 'const sel = fenceLinesShown ? range : clamp(range);'),
			at(ROGUE_CODE_WRITE, 'if (fenceLinesShown) return range;'),
			at(ROGUE_CODE_WRITE, 'if (!fenceLinesShown && crosses) write(clamp(range));'),
			at(ROGUE_CODE_WRITE, 'const span = editSpan(node, range, true);'),
			at(ROGUE_CODE_WRITE, 'editSpan(node, fenceLinesShown ? range : body, fenceLinesShown);'),
			at(ROGUE_CODE_WRITE, 'const span = editSpan(node, range, fenceLinesShown || true);'),
			at(ROGUE_CODE_WRITE, 'const span = editSpan(node, range, fenceLinesShown && !mode);'),
			at(
				ROGUE_CODE_WRITE,
				'const fenceLinesForced = true;\nconst span = editSpan(node, range, fenceLinesForced);'
			),
			at(ROGUE_CODE_WRITE, 'const fenceLinesForced = true;\nif (fenceLinesForced) return;'),
			at(ROGUE_CODE_WRITE, 'const span = paintsFocusedMarkers(mode) ? range : body;'),
			at(ROGUE_CODE_WRITE, 'if (hidesDelimitersAtCaret(mode)) return clamp(range);')
		],
		misses: [
			at(ROGUE_CODE_WRITE, 'const span = editSpan(node, range, fenceLinesShown);'),
			at(ROGUE_CODE_WRITE, 'const span = editSpan(\n\tnode,\n\trange,\n\tfenceLinesShown\n);'),
			at(ROGUE_CODE_WRITE, 'if (composing || !el || fenceLinesShown) return false;'),
			at(ROGUE_CODE_WRITE, 'if (!sel || sel.start === sel.end || fenceLinesShown) return;'),
			at(ROGUE_CODE_WRITE, 'const fenceLinesShown = $derived(paintsFocusedMarkers(mode));'),
			at(`${SOURCE_DIR.textBlock}x.ts`, 'const span = paintsFocusedMarkers(mode) ? range : body;')
		]
	}
];

// ── G4.152 a link is followed only where the shared lookup is asked ─────────

const ROOT_CLICK = `${SOURCE_DIR.components}editor-root/gestures.ts`;

const FOLLOW_ROUTE: FileRule = {
	id: 'G4.152 a link is followed only by the root click, which asks the shared lookup first',
	matches:
		/\bwindow\.open\b|\b(?:activateLink|onLinkActivate)\s*\(|\.closest\(\s*['"`]a\[href\]['"`]\s*\)|\blocation\.(?:assign|replace)\s*\(|\blocation\.href\s*=(?!=)/,
	allowed: {
		[ROOT_CLICK]:
			'the root click: it locates the anchor, and follows only when `clickFollowsAt` says a click follows what that anchor draws',
		[`${SOURCE_DIR.components}Editor.svelte`]:
			"binds the follow to the host's `onLinkActivate`, or the default, for the root click and the link card to call",
		[`${SOURCE_DIR.library}core/url-policy.ts`]:
			"the default follow, which a host's `onLinkActivate` replaces"
	},
	reaches: [ROOT_CLICK],
	reason:
		'a second place that follows a link can follow something Edit link has no way to edit: follow through the root click, whose `clickFollowsAt` is the lookup Edit link reads',
	hits: [
		at(
			`${SOURCE_DIR.blocks}table/TableCellBlock.svelte`,
			"if (follows) window.open(url, '_blank');"
		),
		at(`${SOURCE_DIR.plugins}x/x.ts`, "const a = el.closest('a[href]');"),
		at(`${SOURCE_DIR.textBlock}x.ts`, 'deps.activateLink(href, e);'),
		at(`${SOURCE_DIR.blocks}x.ts`, 'location.href = url;'),
		at(`${SOURCE_DIR.blocks}x.ts`, 'const go = window.open.bind(window);')
	],
	misses: [
		at(`${SOURCE_DIR.textBlock}x.ts`, 'if (follows && anchorFollows(anchor)) open();'),
		at(`${SOURCE_DIR.textBlock}x.ts`, "const href = anchor.getAttribute('href');"),
		at(`${SOURCE_DIR.blocks}x.ts`, 'if (location.href === url) return;')
	]
};

// ── G4.165 a write that moves text without resizing its block reports it ────

const FOCUS_ATTRIBUTION = `${SOURCE_DIR.components}editor-root/focus.ts`;
const CONSTRUCT_REVEAL = `${SOURCE_DIR.textBlock}construct-reveal.ts`;

const TEXT_MOVES: FileRule = {
	id: 'G4.165 every write of a marker-visibility hook reports the moved text',
	matches:
		/\b(?:set|remove|toggle)Attribute\(\s*['"`]data-(?:focused|presentation|editor-theme)['"`]|\bdataset\.(?:focused|presentation|editorTheme)\s*=(?!=)|(?<![[\w-])data-(?:focused|presentation|editor-theme)=\{|\bclassList\.(?:add|remove|toggle|replace)\([^)]*(?:CONSTRUCT_REVEAL_CLASS\b|['"`]md-construct-reveal['"`])|\bclass(?:Name)?\s*=(?!=)[^;\n]*(?:md-construct-reveal|CONSTRUCT_REVEAL_CLASS)|\bclass:md-construct-reveal\b/,
	allowed: {
		[FOCUS_ATTRIBUTION]:
			'moves `data-focused` between hosts and reports both through `textMoves.movedWithin`, as it does a block of bare markers focus enters or leaves',
		[CONSTRUCT_REVEAL]:
			'toggles the reveal class on marker spans and reports the block through `textMoves.movedWithin`',
		[`${SOURCE_DIR.components}Editor.svelte`]:
			'renders the mode and theme attributes; `afterFlip` (`editor-root/mode-flip.ts`) and the theme effect report every block through `textMoves.movedEverywhere`',
		[`${SOURCE_DIR.library}invariants/marker-css-parity.ts`]:
			'marks a probe host it mounts offscreen and removes, which no overlay watches'
	},
	reaches: [FOCUS_ATTRIBUTION, CONSTRUCT_REVEAL],
	reason:
		'showing or hiding markers moves the text inside a block whose box keeps its size, which no resize observer sees: report the change through `textMoves` (`components/overlays/text-moves.ts`) so the overlays over that text measure again, then allow the file here',
	hits: [
		at(`${SOURCE_DIR.blocks}x.ts`, "host.setAttribute('data-focused', '');"),
		at(`${SOURCE_DIR.textBlock}x.ts`, 'span.classList.toggle(CONSTRUCT_REVEAL_CLASS, on);'),
		at(`${SOURCE_DIR.plugins}x/x.ts`, "el.classList.add('md-construct-reveal');"),
		at(`${SOURCE_DIR.components}X.svelte`, '<div data-presentation={mode}>'),
		at(`${SOURCE_DIR.blocks}X.svelte`, '<div data-focused={focused ? "" : undefined}>'),
		at(`${SOURCE_DIR.textBlock}X.svelte`, '<span class:md-construct-reveal={shown}>'),
		at(`${SOURCE_DIR.textBlock}x.ts`, 'span.className = `md-marker ${CONSTRUCT_REVEAL_CLASS}`;'),
		at(`${SOURCE_DIR.blocks}x.ts`, "host.dataset.focused = '';")
	],
	misses: [
		at(
			`${SOURCE_DIR.caret}x.ts`,
			'const revealed = el.classList.contains(CONSTRUCT_REVEAL_CLASS);'
		),
		at(`${SOURCE_DIR.components}x.ts`, "root.closest('[data-presentation]');"),
		at(`${SOURCE_DIR.components}x.ts`, "const mode = root.getAttribute('data-presentation');"),
		at(`${SOURCE_DIR.components}X.svelte`, ":global([data-presentation='reading']) .toolbar {}"),
		at(`${SOURCE_DIR.components}X.svelte`, '<div class="host" data-editor-theme="light">'),
		at(`${SOURCE_DIR.caret}x.ts`, "const shown = span.className === 'md-construct-reveal';")
	]
};

const SOURCES = collectEditorSources();
describeFileRules(
	[
		...RULES,
		...LEAF_RANGE_RULES,
		REF_FOCUS,
		RANGE_PAINT,
		PIECES_UNDER_ORDER_CHECK,
		WIDGET_LIST,
		FOLLOW_ROUTE,
		TEXT_MOVES,
		...CODE_EDIT_SPAN,
		...SYNTAX_MODULES,
		PLUGIN_VIEW_FALLBACK,
		ONE_VIEW_WRAPPER
	],
	SOURCES
);
describeManifests(ITEM_PIECES, SOURCES);
describeManifests(RANGE_REPLACE, SOURCES);
describeManifests(RANGE_INDENT, SOURCES);
describeManifests(TYPED_WRITE_ASKS, SOURCES);
describeManifests(REVEAL_BLOCKS_IN_SVELTE, SOURCES);
describeManifests(SCROLL_WRITERS, SOURCES);
describeManifests(BARE_FOCUSES, SOURCES);
describeFileRules([HELD_BRANDS], SOURCES);
describeCorrections(SOURCES);
describeOwnerWrites(SOURCES);
describeKeyboardEndWrites(SOURCES);
describeMeasureWrites(SOURCES);
describeManifests([MEASURE_CHANNEL], SOURCES);
describeManifests([MARK_HANDLER_CALLERS], SOURCES);
describeManifests(HEIGHT_LIFETIME, SOURCES);
describeManifests(SELECTION_WRITERS, SOURCES);
describeDomPresence(SOURCES);
