// @vitest-environment jsdom
// Every place a live gesture makes or fetches a `StoredAs` (where its bytes are stored), driven
// through the gesture's own entry with bytes the right store and a top-level one read differently.
// Miss-analysis: every container shape read the same at the top level, so a route handed a lone
// paragraph's store instead of its own passed every suite.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TextEditableBlock from '$lib/components/blocks/text/TextEditableBlock.svelte';
import { installPlugins } from '$lib';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { trimTrailingLineEnding } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';
import type { Reading } from '$lib/schema/reading';
import { asDomTextOffset, asRawOffset } from '$lib/cursor/coordinate-spaces';
import { createRangeAtDomTextOffsets } from '$lib/cursor/widget-offset';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt } from '$lib/tree-operations/stored-as';
import { createSharingState } from '$lib/tree-operations/sharing';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { rangeDelete } from '$lib/selection/range-delete';
import { coverRange, rangeCoverage } from '$lib/selection/range-coverage';
import { runDrop } from '$lib/selection/selection-drop';
import { cleanLiveJoinSeam } from '$lib/components/blocks/text/live-join-seam';
import { tableCellPasteSurface } from '$lib/components/blocks/table/table-cell-paste';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { rebalanceLiveSplit } from '$lib/components/blocks/text/live-split-rebalance';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { allowDevWarns } from '../support/warn-gate';
import {
	registerLiveJoinSeamCleaner,
	registerLiveSplitRebalancer,
	__resetLiveJoinSeamCleanerForTests,
	__resetLiveSplitRebalancerForTests
} from '$lib/schema/inline-construct-policy';
import {
	makeBlockListState,
	makeContainerHarness,
	makeEditorActionsDeps,
	makeListContextAt,
	makeStubBlockEdit,
	pasteContext
} from '../harness/editor-actions';
import { withStoredCaret } from '$lib/editor-actions/stored-caret';
import { fixtureReading } from '../harness/fixture-grammar';
import { mountBlock } from '../harness/mount-block';
import { settleEditor } from '../harness/settle';
import { ensurePasteSurface } from '../support/paste-surface';
import { mountCell, noIslands } from '../blocks/table/mount-cell';
import {
	decorationIsland,
	key,
	makeEdgeDispatch,
	mountSurface
} from '../blocks/text/edge-policy-fixture';
import { registerCalloutForTests } from '../selection/chrome-plugins';
import { collectEditorSources, EDITOR_SRC } from '../invariants/lint/scan-source';
import { replaceSelectedWidget } from '$lib/components/blocks/text/widget-interaction';
import { selectWidgetWhole } from '$lib/selection/caret-doors';
import { createSelectionState } from '$lib/selection/selection-state.svelte';

// While `TOP.on`, every store the source makes is a lone top-level paragraph's instead of its own.
const TOP = vi.hoisted(() => ({ on: false }));
vi.mock('$lib/tree-operations/stored-as', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/tree-operations/stored-as')>();
	const { parse: parseDoc } = await import('$lib/core/parser');
	const top = (reading: Reading) => real.storedAsAt(parseDoc('x\n'), [0], reading);
	return {
		storedAsAt: (...args: Parameters<typeof real.storedAsAt>) =>
			TOP.on ? top(args[2]) : real.storedAsAt(...args),
		storedAsIn: (...args: Parameters<typeof real.storedAsIn>) =>
			TOP.on ? top(args[2]) : real.storedAsIn(...args)
	};
});

const LIVE = fixtureReading({}, 'live');

beforeAll(() => {
	registerLiveJoinSeamCleaner(cleanLiveJoinSeam);
	registerLiveSplitRebalancer(rebalanceLiveSplit);
	ensurePasteSurface(tableCellPasteSurface);
});
beforeEach(() => {
	// The caret-edge keys read the mode off the nearest root that names one.
	document.body.dataset.presentation = 'live';
	installPlugins([footnotesPlugin()]);
	registerCalloutForTests();
});
afterEach(() => {
	TOP.on = false;
	document.body.innerHTML = '';
	delete document.body.dataset.presentation;
	window.getSelection()?.removeAllRanges();
});
afterAll(() => {
	__resetLiveJoinSeamCleanerForTests();
	__resetLiveSplitRebalancerForTests();
});

// ── Where the bytes go ───────────────────────────────────────────────────────

// After a to-do's box, `# y` is text; at the top level it is a heading. After a plain item's
// marker, `[ ] y` would turn the item into a to-do; at the top level it is text.
const TODO = { name: 'a to-do', source: '- [ ] **x**# y\n', leaf: [0, 0, 0] };
const ITEM = { name: 'a plain item', source: '- **x**[ ] y\n', leaf: [0, 0, 0] };
const CELL = { name: 'a table cell', source: '| h |\n| - |\n| **x**# y |\n', leaf: [0, 1, 0] };
const QUOTED_TODO = {
	name: 'a to-do in a quote',
	source: '> - [ ] **x**# y\n',
	leaf: [0, 0, 0, 0]
};
const NESTED_TODO = {
	name: 'a nested to-do',
	source: '- p\n  - [ ] **x**# y\n',
	leaf: [0, 0, 1, 0, 0]
};
const FOOTNOTE_TODO = {
	name: 'a to-do in a footnote',
	source: '[^1]: - [ ] **x**# y\n',
	leaf: [0, 0, 0, 0]
};

interface Place {
	name?: string;
	source: string;
	leaf: number[];
}

const CALLOUT = ':::callout T\nbody\n:::\n';

/** The bold `x` every delete takes: the pair it empties goes with it where the bytes still read. */
const X = { start: 2, end: 3 };

/** `x` and the closer after it in `#**x** y`: the opener left behind goes, so `#` meets the text. */
const HASH_RUN = { start: 3, end: 6 };

// ── The entries ──────────────────────────────────────────────────────────────

type Mounted = { el: HTMLElement; blockEdit: ReturnType<typeof makeStubBlockEdit> };

/** The block the editor renders at `place`, and what it commits. */
function mountText(place: Place): Mounted {
	const mounted = mountBlock(TextEditableBlock, {
		source: place.source,
		path: place.leaf,
		overrides: {
			policies: { presentationMode: () => 'live' },
			services: { decorations: noIslands }
		}
	});
	const el = mounted.target.querySelector('.text-editable-block') as HTMLElement;
	return { el, blockEdit: mounted.blockEdit };
}

const mountLiveCell = (raw: string): Mounted => mountCell(raw, { presentationMode: () => 'live' });

function select(el: HTMLElement, start: number, end = start): void {
	el.focus();
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(createRangeAtDomTextOffsets(el, asDomTextOffset(start), asDomTextOffset(end))!);
}

/** The raw bytes each commit wrote, once the gesture has run its course. */
async function commitsAfter(mounted: Mounted, gesture: () => void): Promise<string[]> {
	gesture();
	await settleEditor();
	return vi.mocked(mounted.blockEdit.updateBlockContent).mock.calls.map((call) => call[1]);
}

function beforeInput(el: HTMLElement, inputType: string, data?: string, target?: typeof X): void {
	const e = new InputEvent('beforeinput', { inputType, data, bubbles: true, cancelable: true });
	if (target) {
		const range = createRangeAtDomTextOffsets(
			el,
			asDomTextOffset(target.start),
			asDomTextOffset(target.end)
		);
		Object.defineProperty(e, 'getTargetRanges', { value: () => [range] });
	}
	el.dispatchEvent(e);
}

function cut(el: HTMLElement): void {
	const e = new Event('cut', { bubbles: true, cancelable: true });
	Object.defineProperty(e, 'clipboardData', { value: { setData: () => {}, getData: () => '' } });
	el.dispatchEvent(e);
}

/** An IME run typed over `range`, the DOM left holding `composed` when it ends. */
function compose(el: HTMLElement, range: typeof X, composed: string): void {
	select(el, range.start, range.end);
	el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	el.textContent = composed;
	select(el, range.start + 1);
	el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
}

const deleteX = (m: Mounted) => () => {
	select(m.el, X.end);
	beforeInput(m.el, 'deleteContentBackward', undefined, X);
};
const cutX = (m: Mounted) => () => {
	select(m.el, X.start, X.end);
	cut(m.el);
};
const backspaceAfterX = (m: Mounted) => () => {
	select(m.el, X.end);
	m.el.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
	);
};
const typeAt = (m: Mounted, caret: number, typed: string) => () => {
	select(m.el, caret);
	beforeInput(m.el, 'insertText', typed);
};

/** The caret-edge key dispatch over the leaf at `place`, with the store getter a block hands it. */
function dispatchAt(
	place: Place,
	content: Node[],
	overrides: Parameters<typeof makeEdgeDispatch>[2]
) {
	const doc = parse(place.source);
	const node = nodeAt(doc, place.leaf) as CstNode;
	const el = mountSurface(content, 'live');
	const h = makeEdgeDispatch(node, el, {
		storedAs: () => storedAsAt(doc, place.leaf, LIVE),
		...overrides
	});
	return { ...h, el };
}

const textOf = (place: Place): string =>
	trimTrailingLineEnding((nodeAt(parse(place.source), place.leaf) as CstNode).raw);

/** Delete or Backspace over a selection that reaches into the list item's marker prefix. */
function deleteFromMarker(place: Place): string[] {
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.setAttribute('contenteditable', 'false');
	marker.textContent = '- ';
	const text = document.createTextNode(textOf(place));
	const h = dispatchAt(place, [marker, text], {
		getRawSelection: () => ({ start: asRawOffset(0), end: asRawOffset(X.end) })
	});
	const range = document.createRange();
	range.setStart(marker.firstChild!, 0);
	range.setEnd(text, X.end);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(range);
	h.handleKeydown(key('Backspace'), asRawOffset(0));
	return h.edits.map((edit) => edit[1]);
}

/** A key typed over a selection that opens at a decoration widget, where the browser drops it. */
function typedAtWidget(place: Place, range: typeof X, typed: string): string[] {
	const display = textOf(place);
	const widget = decorationIsland(range.start);
	const content = [
		document.createTextNode(display.slice(0, range.start)),
		widget,
		document.createTextNode(display.slice(range.start))
	];
	const h = dispatchAt(place, content, {
		hasIslands: () => true,
		getRawSelection: () => ({ start: asRawOffset(range.start), end: asRawOffset(range.end) })
	});
	const whole = document.createRange();
	whole.selectNodeContents(h.el);
	window.getSelection()!.removeAllRanges();
	window.getSelection()!.addRange(whole);
	h.handleKeydown(key(typed), asRawOffset(range.start));
	return h.edits.map((edit) => edit[1]);
}

/** A delimiter typed where the caret stands just inside a hidden closing run. */
function typedBesideHiddenRun(place: Place, caret: number, typed: string): string[] {
	const h = dispatchAt(place, [document.createTextNode(textOf(place))], {
		getEdgeAffinity: () => 'far'
	});
	h.handleKeydown(key(typed), asRawOffset(caret));
	return h.edits.map((edit) => edit[1]);
}

/** Backspace right after the entity that opens the leaf's bold word. */
function backspaceAfterEntity(place: Place): string[] {
	const h = dispatchAt(place, [document.createTextNode(textOf(place))], {});
	h.handleKeydown(key('Backspace'), asRawOffset(8));
	return h.edits.map((edit) => edit[1]);
}

/** Backspace on the image the leaf's bold word holds, selected. */
async function backspaceOnSelectedImage(place: Place): Promise<string[]> {
	const doc = parse(place.source);
	const written: string[] = [];
	const selection = createSelectionState();
	selectWidgetWhole(selection, { paragraphPath: place.leaf, sourceStart: 2, preSelectOffset: 2 });
	await replaceSelectedWidget(
		{
			node: nodeAt(doc, place.leaf) as CstNode,
			selection,
			storedAs: () => storedAsAt(doc, place.leaf, LIVE)
		},
		{ start: 2, end: 13 },
		'',
		(edit) => {
			written.push(edit.raw);
			return withStoredCaret(Promise.resolve(true), edit.caret);
		}
	);
	return written;
}

async function mergeNext(source: string, containerPath: number[]): Promise<string> {
	const h = makeContainerHarness(source, containerPath, { reading: LIVE });
	await h.bundle.blockEdit.mergeWithNext(0);
	return serialize(h.deps.doc);
}

/** Enter at `offset` in the first item's text, through the list's own split. */
async function enterInFirstItem(source: string, offset: number): Promise<string> {
	const list = parse(source).children[0];
	const { deps } = makeEditorActionsDeps([list], { reading: LIVE });
	const liveItem = () => deps.doc.children[0].children![0];
	registerBlockListState(list.children![0], makeBlockListState(liveItem, ['text']) as never);
	const { listContext } = makeListContextAt(deps, 0, { ids: ['item-0'] });
	await listContext.splitItemAtOffset(0, 0, offset);
	// A top-level store installs a to-do's `# ` text as a heading behind the box, which the
	// read-back checks catch.
	if (TOP.on) allowDevWarns(['invariant:task-marker-slot', 'invariant:reads-back']);
	return serialize(deps.doc);
}

function deleteRange(source: string, from: [number[], number], to: [number[], number]): string {
	const doc = parse(source);
	const range = coverRange(doc, { path: from[0], offset: from[1] }, { path: to[0], offset: to[1] });
	rangeDelete(doc, rangeCoverage(doc, range), createSharingState(), LIVE, 'Backspace');
	return serialize(doc);
}

/** Drags `x` out of the leaf at `place` to the start of a paragraph after it. */
async function dragXAway(place: Place, inCell: boolean): Promise<string> {
	const harness = makeEditorActionsDeps(`${place.source}\nz\n`, { reading: LIVE });
	const controller = createUndoController(harness.deps);
	const deps = {
		editorRoot: document.createElement('div'),
		getDoc: () => harness.deps.doc,
		controller,
		coordinator: createPasteCoordinator(harness.deps, controller),
		reading: LIVE,
		activePlugins: everyInstalledPlugin,
		events: harness.events,
		setDropCaret: () => {},
		isReadOnly: () => false
	};
	await runDrop(
		deps,
		{ path: place.leaf, ...X, inCell, text: 'x' },
		{ path: [1], offset: 0 },
		false
	);
	return serialize(deps.getDoc());
}

/** Pastes `text` over `range`: the bytes the leaf's commit writes. */
async function pasteOver(place: Place, range: typeof X, text: string): Promise<string[]> {
	const { deps } = makeEditorActionsDeps(place.source, { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	await pasteDispatch(
		{ pastedText: text, targetPath: place.leaf, offset: range.start, preDelete: range },
		pasteContext({
			doc: deps.doc,
			blockEdit,
			reading: LIVE,
			controller: createPasteCoordinator(deps, createUndoController(deps))
		})
	);
	return vi.mocked(blockEdit.updateBlockContent).mock.calls.map((call) => call[1]);
}

// ── The routes ───────────────────────────────────────────────────────────────

interface Row {
	shape: string;
	run(): Promise<unknown> | unknown;
	/** What the right store gives; a top-level store must give something else. */
	want: unknown;
}

interface Family {
	name: string;
	/** Each file's calls that make or fetch a store, which this family's rows run through. */
	stores: Record<string, number>;
	/** Files that hand a store they were given to a rewrite, and make none. */
	passesOn?: string[];
	rows: Row[];
}

const FAMILIES: Family[] = [
	{
		name: 'a range edit on beforeinput',
		stores: {
			'components/blocks/text/TextEditableBlock.svelte': 2,
			'components/blocks/table/TableCellBlock.svelte': 2
		},
		rows: [
			{ shape: 'a to-do', run: () => withText(TODO, deleteX), want: ['# y\n'] },
			{ shape: 'a plain item', run: () => withText(ITEM, deleteX), want: [] },
			{ shape: 'a table cell', run: () => withCell('**x**# y', deleteX), want: ['# y'] }
		]
	},
	{
		name: 'a composition over a selection',
		stores: { 'components/blocks/text/TextEditableBlock.svelte': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () =>
					withText(
						{ source: '- [ ] **x** y\n', leaf: [0, 0, 0] },
						(m) => () => compose(m.el, { start: 2, end: 5 }, '**# y')
					),
				want: ['# y\n']
			},
			{
				shape: 'a plain item',
				run: () =>
					withText(
						{ source: '- **x** ] y\n', leaf: [0, 0, 0] },
						(m) => () => compose(m.el, { start: 2, end: 5 }, '**[ ] y')
					),
				want: ['**[ ] y\n']
			}
		]
	},
	{
		name: 'a delimiter typed where it may pair',
		stores: {
			'components/blocks/text/TextEditableBlock.svelte': 1,
			'components/blocks/table/TableCellBlock.svelte': 1,
			'components/blocks/text/edge-policy-dispatch.ts': 1
		},
		rows: [
			{
				shape: 'a to-do',
				run: () => withText({ source: '- [ ] # y\n', leaf: [0, 0, 0] }, (m) => typeAt(m, 2, '*')),
				want: ['# **y\n']
			},
			{
				shape: 'a table cell',
				run: () => withCell('# y', (m) => typeAt(m, 2, '*')),
				want: ['# **y']
			},
			{
				shape: 'a to-do, beside a hidden run',
				run: () =>
					typedBesideHiddenRun({ source: '- [ ] # **bold** text\n', leaf: [0, 0, 0] }, 8, '`'),
				want: ['# **bold**`` text\n']
			}
		]
	},
	{
		name: 'Backspace at a hidden run',
		stores: { 'components/blocks/text/edge-policy-dispatch.ts': 1 },
		rows: [
			{ shape: 'a to-do', run: () => withText(TODO, backspaceAfterX), want: ['# y\n'] },
			{ shape: 'a plain item', run: () => withText(ITEM, backspaceAfterX), want: [] },
			{ shape: 'a table cell', run: () => withCell('**x**# y', backspaceAfterX), want: ['# y'] }
		]
	},
	{
		// One range replace serves both: a selection the browser would not edit, and a whole widget.
		name: 'a key the block writes over a range',
		stores: { 'components/blocks/text/edge-policy-dispatch.ts': 1 },
		rows: [
			{
				shape: 'a to-do, a whole widget',
				run: () => backspaceAfterEntity({ source: '- [ ] **&copy;**# y\n', leaf: [0, 0, 0] }),
				want: ['# y\n']
			},
			{
				shape: 'a plain item, a whole widget',
				run: () => backspaceAfterEntity({ source: '- **&copy;**[ ] y\n', leaf: [0, 0, 0] }),
				want: ['****[ ] y\n']
			},
			{ shape: 'a to-do, from its marker', run: () => deleteFromMarker(TODO), want: ['# y\n'] },
			{
				shape: 'a plain item, from its marker',
				run: () => deleteFromMarker(ITEM),
				want: ['**[ ] y\n']
			},
			{
				shape: 'a to-do, at a widget',
				run: () =>
					typedAtWidget({ source: '- [ ] **x** y\n', leaf: [0, 0, 0] }, { start: 2, end: 5 }, '#'),
				want: ['# y\n']
			},
			{
				shape: 'a plain item, at a widget',
				run: () =>
					typedAtWidget({ source: '- **x** ] y\n', leaf: [0, 0, 0] }, { start: 2, end: 5 }, '['),
				want: ['**[ ] y\n']
			}
		]
	},
	{
		name: 'a cut',
		stores: {
			'components/blocks/text/text-clipboard.ts': 1,
			'components/blocks/table/TableCellBlock.svelte': 1
		},
		rows: [
			{ shape: 'a to-do', run: () => withText(TODO, cutX), want: ['# y\n'] },
			{ shape: 'a plain item', run: () => withText(ITEM, cutX), want: ['****[ ] y\n'] },
			{ shape: 'a to-do in a quote', run: () => withText(QUOTED_TODO, cutX), want: ['# y\n'] },
			{ shape: 'a nested to-do', run: () => withText(NESTED_TODO, cutX), want: ['# y\n'] },
			{ shape: 'a table cell', run: () => withCell('**x**# y', cutX), want: ['# y'] }
		]
	},
	{
		name: 'a key on a selected widget',
		stores: { 'components/blocks/text/widget-interaction.ts': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () =>
					backspaceOnSelectedImage({ source: '- [ ] **![a](b.png)**# y\n', leaf: [0, 0, 0] }),
				want: ['# y\n']
			},
			{
				shape: 'a plain item',
				run: () =>
					backspaceOnSelectedImage({ source: '- **![a](b.png)**[ ] y\n', leaf: [0, 0, 0] }),
				want: ['****[ ] y\n']
			}
		]
	},
	{
		// After a to-do's box, `# **bo**` is text; at the top level it is a heading.
		name: 'a split',
		stores: { 'tree-operations/node-ops.ts': 2, 'editor-actions/list-context.ts': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () => enterInFirstItem('- [ ] # **bo ld**\n', 6),
				want: '- [ ] # **bo**\n- [ ]  **ld**\n'
			}
		]
	},
	{
		name: 'a merge',
		stores: { 'tree-operations/node-ops.ts': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () => mergeNext('- [ ] # a**b**\n\n  **c**\n', [0, 0]),
				want: '- [ ] # a**bc**\n'
			},
			{
				shape: 'a to-do in a quote',
				run: () => mergeNext('> - [ ] # a**b**\n>\n>   **c**\n', [0, 0, 0]),
				want: '> - [ ] # a**bc**\n'
			}
		]
	},
	{
		name: 'a range delete',
		stores: { 'selection/range-delete.ts': 1 },
		rows: [
			...[TODO, QUOTED_TODO, NESTED_TODO, FOOTNOTE_TODO].map((place) => ({
				shape: place.name,
				run: () => deleteRange(place.source, [place.leaf, X.start], [place.leaf, X.end]),
				want: place.source.replace('**x**', '')
			})),
			{
				shape: ITEM.name,
				run: () => deleteRange(ITEM.source, [ITEM.leaf, X.start], [ITEM.leaf, X.end]),
				want: '- ****[ ] y\n'
			},
			{
				shape: 'across two to-dos',
				run: () => deleteRange('- [ ] **a**\n- [ ] **c**# y\n', [[0, 0, 0], 2], [[0, 1, 0], 3]),
				want: '- [ ] # y\n'
			}
		]
	},
	{
		name: 'a range delete that stops at a title row',
		stores: { 'selection/range-delete-ceremony.ts': 2 },
		rows: [
			{
				shape: 'the kept head of a to-do',
				run: () => deleteRange(`- [ ] **# y** z\n\n${CALLOUT}`, [[0, 0, 0], 5], [[1, 1], 2]),
				want: `- [ ] # y\n\n:::callout\ndy\n:::\n`
			},
			{
				shape: 'the kept head of a plain item',
				run: () => deleteRange(`- **[ ] y** z\n\n${CALLOUT}`, [[0, 0, 0], 7], [[1, 1], 2]),
				want: `- **[ ] y\n\n:::callout\ndy\n:::\n`
			},
			{
				shape: 'the kept tail of a to-do',
				run: () => deleteRange(`${CALLOUT}\n- [ ] **x**# y\n`, [[0, 1], 2], [[1, 0, 0], 3]),
				want: `:::callout T\nbo\n:::\n\n- [ ] # y\n`
			},
			{
				shape: 'the kept tail of a plain item',
				run: () => deleteRange(`${CALLOUT}\n- **x**[ ] y\n`, [[0, 1], 2], [[1, 0, 0], 3]),
				want: `:::callout T\nbo\n:::\n\n- **[ ] y\n`
			}
		]
	},
	{
		name: 'a drag that moves a selection',
		stores: { 'selection/selection-drop.ts': 2 },
		rows: [
			{ shape: 'a to-do', run: () => dragXAway(TODO, false), want: '- [ ] # y\n\nxz\n' },
			{ shape: 'a plain item', run: () => dragXAway(ITEM, false), want: '- ****[ ] y\n\nxz\n' },
			{
				shape: 'a table cell',
				run: () => dragXAway(CELL, true),
				want: '| h |\n| - |\n| # y |\n\nxz\n'
			}
		]
	},
	{
		name: 'a paste over a selection',
		stores: { 'tree-operations/paste/dispatch.ts': 1 },
		passesOn: ['tree-operations/paste/hooks.ts', 'components/blocks/table/table-cell-paste.ts'],
		rows: [
			// The pasted text lands after a run the cut strands, so the join still has something to drop.
			{
				shape: 'a to-do',
				run: () => pasteOver({ source: '- [ ] #**x** y\n', leaf: [0, 0, 0] }, HASH_RUN, ' a'),
				want: ['# a y\n']
			},
			{
				shape: 'a plain item',
				run: () =>
					pasteOver({ source: '- **x** ] y\n', leaf: [0, 0, 0] }, { start: 2, end: 5 }, '['),
				want: ['**[ ] y\n']
			},
			{
				shape: 'a table cell',
				run: () =>
					pasteOver(
						{ source: '| h |\n| - |\n| # **x** y |\n', leaf: [0, 1, 0] },
						{ start: 4, end: 7 },
						'a'
					),
				want: ['# a y']
			}
		]
	}
];

async function withText(place: Place, gesture: (m: Mounted) => () => void): Promise<string[]> {
	const mounted = mountText(place);
	return commitsAfter(mounted, gesture(mounted));
}

async function withCell(raw: string, gesture: (m: Mounted) => () => void): Promise<string[]> {
	const mounted = mountLiveCell(raw);
	return commitsAfter(mounted, gesture(mounted));
}

describe.each(FAMILIES)('$name', ({ rows }) => {
	it.each(rows)('$shape: reads the bytes where they are stored', async ({ run, want }) => {
		expect(await run()).toEqual(want);
	});

	it.each(rows)('$shape: a top-level store would answer differently', async ({ run, want }) => {
		TOP.on = true;
		const why = 'these bytes read the same at the top level, so the row cannot tell stores apart';
		expect(await run(), why).not.toEqual(want);
	});
});

// ── The route list ───────────────────────────────────────────────────────────

/** The rewrites themselves: each reads through the store it is handed and makes none. */
const REWRITES = [
	'tree-operations/leaf-range.ts',
	'components/blocks/text/live-selection-edit.ts',
	'components/blocks/text/construct-edge-delete.ts',
	'components/blocks/text/live-join-seam.ts',
	'components/blocks/text/live-split-rebalance.ts',
	'core/inline/live-edit/read-back.ts'
];

/** A store made from the tree, or fetched from the getter a block hands its helpers. */
const MAKES_A_STORE = /(?<![\w$])(?<!function\s)(?:storedAsAt|storedAsIn)\s*\(|\bstoredAs\(\)/g;

/** A call that hands a store to a rewrite that removes bytes, or asks one what a line reads as. */
const HANDS_ON_A_STORE =
	/(?<![\w$.])(?<!function\s)(?:cleanJoinedRaw|joinLeaves|replaceRangeInLeaf|applyLiveRangeEdit|resolveEdgeDeletion|keepsKindAt|cleanTruncatedProse|readBack|splitNode)\s*\(/;

describe('the route list', () => {
	const sources = collectEditorSources(EDITOR_SRC);
	const inLib = (relPath: string) => relPath.replace(/^src\/lib\//, '');

	it('matches a store made or fetched, never a definition or a reference', () => {
		const count = (code: string) => [...code.matchAll(MAKES_A_STORE)].length;
		expect(count('storedAsAt(doc, p, r); storedAsIn(h, 0, r); deps.storedAs(); storedAs()')).toBe(
			4
		);
		expect(
			count('export function storedAsAt(doc) {} const s = { storedAs, x: storedAsAtOf() }')
		).toBe(0);
	});

	// A store made where no row runs is a route whose store nothing checks.
	it('every store the source makes or fetches is a family’s', () => {
		const found: Record<string, number> = {};
		for (const file of sources) {
			const calls = [...file.code.matchAll(MAKES_A_STORE)].length;
			if (calls > 0) found[inLib(file.relPath)] = calls;
		}
		const claimed: Record<string, number> = {};
		for (const { stores } of FAMILIES) {
			for (const [file, calls] of Object.entries(stores))
				claimed[file] = (claimed[file] ?? 0) + calls;
		}
		const why = 'a store is made where no row runs: name it in a family, with a row that reads it';
		expect(found, why).toEqual(claimed);
	});

	it('every file that hands a store on is a family’s, or a rewrite', () => {
		const found = sources
			.filter((file) => HANDS_ON_A_STORE.test(file.code))
			.map((f) => inLib(f.relPath));
		const named = FAMILIES.flatMap(({ stores, passesOn }) => [
			...Object.keys(stores),
			...(passesOn ?? [])
		]);
		expect(found.sort()).toEqual([...new Set([...named, ...REWRITES])].sort());
	});

	it('every family has a row', () => {
		expect(FAMILIES.filter(({ rows }) => rows.length === 0).map(({ name }) => name)).toEqual([]);
	});
});
