// @vitest-environment jsdom
// Every place a live gesture makes or fetches a `StoredAs` (where its bytes are stored), driven
// through the gesture's own entry with bytes the right store and a top-level one read differently.
// Miss-analysis: every container shape read the same at the top level, so a route handed a lone
// paragraph's store instead of its own passed every suite.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import TextEditableBlock from '#lib/components/blocks/text/TextEditableBlock.svelte';
import { installPlugins } from '#lib';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { Reading } from '#lib/schema/reading.js';
import { asDomTextOffset, asRawOffset } from '#lib/core/coordinate-spaces.js';
import { createRangeAtDomTextOffsets } from '#lib/browser/offsets.js';
import { nodeAt } from '#lib/tree-operations/node-primitives.js';
import { storedAsAt } from '#lib/tree-operations/stored-as.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { collectCrossBlockText } from '#lib/selection/clipboard-text.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { movedText, runDrop } from '#lib/selection/selection-drop.js';
import { createInlineRangeCommit } from '#lib/editor-actions/inline-range-commit.js';
import { tableCellPasteSurface } from '#lib/components/blocks/table/table-cell-paste.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createPasteCoordinator } from '#lib/editor-actions/paste-coordinator.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { registerBlockListState } from '#lib/block-lists/state-registry.js';
import { allowDevWarns } from '../support/warn-gate';
import {
	makeBlockListState,
	makeContainerHarness,
	makeEditorActionsDeps,
	makeListContextAt,
	makeStubBlockEdit,
	runPasteDispatch,
	makePasteCommit
} from '../harness/editor-actions';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { createCaretMemory, type CaretMemory } from '#lib/caret/caret-memory.js';
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
import { replaceSelectedWidget } from '#lib/components/blocks/text/widget-interaction.js';
import { selectWidgetWhole } from '#lib/selection/place-caret.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { testCaretWriter } from '#lib/test/harness/caret-writer.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';

// While `TOP.on`, every store the source makes is a lone top-level paragraph's instead of its own.
const TOP = vi.hoisted(() => ({ on: false }));
vi.mock('#lib/tree-operations/stored-as.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('#lib/tree-operations/stored-as.js')>();
	const { parse: parseDoc } = await import('#lib/core/parser.js');
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
function mountText(place: Place, caretMemory?: CaretMemory): Mounted {
	const mounted = mountBlock(TextEditableBlock, {
		source: place.source,
		path: place.leaf,
		overrides: {
			mode: () => 'live',
			services: { decorations: noIslands, ...(caretMemory ? { caretMemory } : {}) }
		}
	});
	const el = mounted.target.querySelector('.text-editable-block') as HTMLElement;
	return { el, blockEdit: mounted.blockEdit };
}

const mountLiveCell = (raw: string): Mounted => mountCell(raw, { mode: () => 'live' });

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

/** What a copy of `range` in the mounted block puts on the clipboard. */
function copied(mounted: Mounted, range: typeof X): string {
	select(mounted.el, range.start, range.end);
	let text = '';
	const e = new Event('copy', { bubbles: true, cancelable: true });
	const clipboardData = {
		setData: (_type: string, value: string) => (text = value),
		getData: () => ''
	};
	Object.defineProperty(e, 'clipboardData', { value: clipboardData });
	mounted.el.dispatchEvent(e);
	return text;
}

/** What a copy from `start` in the first leaf to `end` in the next block puts on the clipboard. */
function copiedAcross(source: string, start: SelectionPoint, end: SelectionPoint): string {
	const doc = parse(source);
	return collectCrossBlockText(doc, rangeCoverage(doc, coverRange(doc, start, end)), LIVE);
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
// The key's keydown passes, so its delete arrives at `beforeinput`.
const backspaceAfterX = (m: Mounted) => () => {
	select(m.el, X.end);
	m.el.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
	);
	m.el.dispatchEvent(
		new InputEvent('beforeinput', {
			inputType: 'deleteContentBackward',
			bubbles: true,
			cancelable: true
		})
	);
};
const enterOverX = (m: Mounted) => () => {
	select(m.el, X.start, X.end);
	m.el.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
	);
};
const lineBreakOverX = (m: Mounted) => () => {
	select(m.el, X.start, X.end);
	beforeInput(m.el, 'insertLineBreak');
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

/** A delimiter typed after the caret stepped past a hidden closing run by typing its closer. */
async function typedPastHiddenRun(place: Place, caret: number, typed: string): Promise<string[]> {
	const mounted = mountText(place, createCaretMemory());
	mounted.el.focus();
	select(mounted.el, caret);
	beforeInput(mounted.el, 'insertText', '*');
	await settleEditor();
	return commitsAfter(mounted, () => beforeInput(mounted.el, 'insertText', typed));
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
	selectWidgetWhole(selection, testCaretWriter, {
		paragraphPath: place.leaf,
		sourceStart: 2,
		preSelectOffset: 2
	});
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

function backspaceRange(source: string, from: [number[], number], to: [number[], number]): string {
	const doc = parse(source);
	const [start, end] = [from, to].map(([path, offset]) => ({ path, offset }));
	deleteRange(doc, start, end, { reading: LIVE, gesture: 'Backspace' });
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

/** Drops a copy of `text` at `offset` of the leaf at `place`, as a drag with the copy key held. */
async function dropCopy(place: Place, offset: number, text: string): Promise<string> {
	const harness = makeEditorActionsDeps(`${place.source}\nsrc\n`, { reading: LIVE });
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
	const from = { path: [1], start: 0, end: 3, inCell: false, text };
	await runDrop(deps, from, { path: place.leaf, offset }, true);
	return serialize(deps.getDoc());
}

/** The bytes a drag of `range` carries out of the leaf at `place`. */
function dragText(place: Place, range: typeof X): string | null {
	const { deps } = makeEditorActionsDeps(place.source, { reading: LIVE });
	const drop = { getDoc: () => deps.doc, reading: LIVE, activePlugins: everyInstalledPlugin };
	return movedText(drop, { path: place.leaf, ...range, inCell: false });
}

/** Takes `range` out of the leaf at `place` through the write the popovers and menus share. */
async function removeInline(place: Place, range: typeof X): Promise<string> {
	const harness = makeEditorActionsDeps(place.source, { reading: LIVE });
	const write = createInlineRangeCommit({
		deps: harness.deps,
		controller: createUndoController(harness.deps)
	});
	await write.commitInlineRange(place.leaf, range.start, range.end, '', range.start);
	return serialize(harness.deps.doc);
}

/** Pastes `text` over `range`: the bytes the leaf's commit writes. */
async function pasteOver(place: Place, range: typeof X, text: string): Promise<string[]> {
	const h = makePasteCommit(place.source, { reading: LIVE });
	const blockEdit = makeStubBlockEdit();
	await runPasteDispatch(
		h,
		{ pastedText: text, targetPath: place.leaf, offset: range.start, preDelete: range },
		{ blockEdit }
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
	/** Files that make no store but call a route taking one: they hand on a store they were given,
	 *  or leave the route to make its own. */
	passesOn?: string[];
	rows: Row[];
}

const FAMILIES: Family[] = [
	{
		name: 'a range edit on beforeinput',
		stores: {
			'components/blocks/text/TextEditableBlock.svelte': 1,
			'components/blocks/table/TableCellBlock.svelte': 1,
			'components/blocks/text/typed-input.ts': 1
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
		// A link never grows at its edge, so the composed text lands outside the one the range
		// emptied, and the link's runs go with it.
		rows: [
			{
				shape: 'a to-do',
				run: () =>
					withText(
						{ source: '- [ ] [x](u) y\n', leaf: [0, 0, 0] },
						(m) => () => compose(m.el, { start: 1, end: 6 }, '[# y')
					),
				want: ['# y\n']
			},
			{
				shape: 'a plain item',
				run: () =>
					withText(
						{ source: '- [x](u) ] y\n', leaf: [0, 0, 0] },
						(m) => () => compose(m.el, { start: 1, end: 6 }, '[[ ] y')
					),
				want: ['[[ ] y\n']
			}
		]
	},
	{
		name: 'a delimiter typed where it may pair',
		stores: { 'components/blocks/text/typed-input.ts': 1 },
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
					typedPastHiddenRun({ source: '- [ ] # **bold** text\n', leaf: [0, 0, 0] }, 8, '`'),
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
					typedAtWidget({ source: '- [ ] [x](u) y\n', leaf: [0, 0, 0] }, { start: 1, end: 6 }, '#'),
				want: ['# y\n']
			},
			{
				shape: 'a plain item, at a widget',
				run: () =>
					typedAtWidget({ source: '- [x](u) ] y\n', leaf: [0, 0, 0] }, { start: 1, end: 6 }, '['),
				want: ['[[ ] y\n']
			}
		]
	},
	{
		// The removal is the first write; the break after it runs at the caret the removal left.
		name: 'a line break over a selection',
		stores: {
			'components/blocks/text/TextEditableBlock.svelte': 1,
			'components/blocks/table/TableCellBlock.svelte': 1
		},
		rows: [
			{ shape: 'a to-do', run: () => withText(TODO, enterOverX), want: ['# y\n'] },
			{ shape: 'a plain item', run: () => withText(ITEM, enterOverX), want: ['****[ ] y\n'] },
			{
				shape: 'a table cell',
				run: async () => (await withCell('**x**# y', lineBreakOverX)).slice(0, 1),
				want: ['# y']
			}
		]
	},
	{
		name: 'a cut',
		stores: {
			'components/blocks/text/text-clipboard.ts': 1
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
		// The copy starts at the bold's hidden closer, which empties it, so the closer goes and `# y`
		// reads as text in a to-do or a cell; at the top level it is a heading, so the closer stays.
		name: 'the bytes a copy carries',
		stores: {
			'components/blocks/text/text-clipboard.ts': 1,
			'selection/clipboard-text.ts': 1
		},
		rows: [
			{ shape: 'a to-do', run: () => copied(mountText(TODO), { start: 3, end: 8 }), want: '# y' },
			{
				shape: 'a table cell',
				run: () => copied(mountLiveCell('**x**# y'), { start: 3, end: 8 }),
				want: '# y'
			},
			{
				shape: 'a to-do, across blocks',
				run: () =>
					copiedAcross(
						'- [ ] **x**# y\n\nnext\n',
						{ path: [0, 0, 0], offset: 3 },
						{ path: [1], offset: 2 }
					),
				want: '- [ ] # y\n\nne'
			}
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
		// A block's own Enter, whose halves stay in its holder: the split makes both stores itself.
		passesOn: ['editor-actions/block-edit-core.ts'],
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
		stores: { 'selection/cross-block/range-delete/range-delete.ts': 1 },
		rows: [
			...[TODO, QUOTED_TODO, NESTED_TODO, FOOTNOTE_TODO].map((place) => ({
				shape: place.name,
				run: () => backspaceRange(place.source, [place.leaf, X.start], [place.leaf, X.end]),
				want: place.source.replace('**x**', '')
			})),
			{
				shape: ITEM.name,
				run: () => backspaceRange(ITEM.source, [ITEM.leaf, X.start], [ITEM.leaf, X.end]),
				want: '- ****[ ] y\n'
			},
			{
				shape: 'across two to-dos',
				run: () => backspaceRange('- [ ] **a**\n- [ ] **c**# y\n', [[0, 0, 0], 2], [[0, 1, 0], 3]),
				want: '- [ ] # y\n'
			}
		]
	},
	{
		name: 'a range delete that stops at a title row',
		stores: { 'selection/cross-block/range-delete/range-delete-ceremony.ts': 2 },
		rows: [
			{
				shape: 'the kept head of a to-do',
				run: () => backspaceRange(`- [ ] # y**z**\n\n${CALLOUT}`, [[0, 0, 0], 5], [[1, 1], 2]),
				want: `- [ ] # y\n\n:::callout\ndy\n:::\n`
			},
			{
				shape: 'the kept tail of a to-do',
				run: () => backspaceRange(`${CALLOUT}\n- [ ] **x**# y\n`, [[0, 1], 2], [[1, 0, 0], 3]),
				want: `:::callout T\nbo\n:::\n\n- [ ] # y\n`
			},
			{
				shape: 'the kept tail of a plain item',
				run: () => backspaceRange(`${CALLOUT}\n- **x**[ ] y\n`, [[0, 1], 2], [[1, 0, 0], 3]),
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
		// The range starts at the bold's hidden closer, which empties it, so the closer goes. In a
		// to-do or a cell `# y` then reads as text; at the top level it is a heading, so it stays.
		name: 'the bytes a drag carries',
		stores: { 'selection/selection-drop.ts': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () =>
					dragText({ source: '- [ ] **x**# y z\n', leaf: [0, 0, 0] }, { start: 3, end: 8 }),
				want: '# y'
			},
			{
				shape: 'a plain item',
				run: () => dragText({ source: '- **x**[ ] y z\n', leaf: [0, 0, 0] }, { start: 3, end: 10 }),
				want: '**[ ] y'
			},
			{
				shape: 'a table cell',
				run: () =>
					dragText(
						{ source: '| h |\n| - |\n| **x**# y z |\n', leaf: [0, 1, 0] },
						{ start: 3, end: 8 }
					),
				want: '# y'
			}
		]
	},
	{
		// A to-do's `# ` is text, so the dropped bold joins the bold it lands in; at the top level the
		// joined text would read as a heading, so the plain splice stands.
		name: 'the text a drop lands',
		stores: { 'selection/selection-drop.ts': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () => dropCopy({ source: '- [ ] # **bo**d z\n', leaf: [0, 0, 0] }, 6, '**ld** an'),
				want: '- [ ] # **bold** and z\n\nsrc\n'
			}
		]
	},
	{
		name: 'a popover or menu write over a range',
		stores: { 'editor-actions/inline-range-commit.ts': 1 },
		rows: [
			{
				shape: 'a to-do',
				run: () =>
					removeInline(
						{ source: '- [ ] **![a](b.png)**# y\n', leaf: [0, 0, 0] },
						{ start: 2, end: 13 }
					),
				want: '- [ ] # y\n'
			},
			{
				shape: 'a plain item',
				run: () =>
					removeInline(
						{ source: '- **![a](b.png)**[ ] y\n', leaf: [0, 0, 0] },
						{ start: 2, end: 13 }
					),
				want: '- ****[ ] y\n'
			}
		]
	},
	{
		name: 'a paste over a selection',
		stores: { 'tree-operations/paste/dispatch.ts': 1 },
		passesOn: ['tree-operations/paste/hooks.ts', 'components/blocks/table/table-cell-paste.ts'],
		rows: [
			// The pasted text lands after a run the cut empties, so the join still has something to drop.
			{
				shape: 'a to-do',
				run: () => pasteOver({ source: '- [ ] #**x** y\n', leaf: [0, 0, 0] }, HASH_RUN, ' a'),
				want: ['# a y\n']
			},
			{
				shape: 'a plain item',
				run: () =>
					pasteOver({ source: '- [x](u) ] y\n', leaf: [0, 0, 0] }, { start: 1, end: 6 }, '['),
				want: ['[[ ] y\n']
			},
			{
				shape: 'a table cell',
				run: () =>
					pasteOver(
						{ source: '| h |\n| - |\n| # [x](u) y |\n', leaf: [0, 1, 0] },
						{ start: 3, end: 8 },
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
	'core/inline/live-edit/live-join.ts',
	'core/inline/live-edit/live-split.ts',
	'core/inline/live-edit/read-back.ts'
];

/** A store made from the tree, or fetched from the getter a block hands its helpers. */
const MAKES_A_STORE = /(?<![\w$])(?<!function\s)(?:storedAsAt|storedAsIn)\s*\(|\bstoredAs\(\)/g;

/** The calls that hand a store to a rewrite that removes bytes, or ask one what a line reads as. */
const STORE_TAKERS = [
	'cleanJoinedRaw',
	'joinLeaves',
	'replaceRangeInLeaf',
	'bytesLeavingLeaf',
	'applyLiveRangeEdit',
	'resolveEdgeDeletion',
	'keepsKindAt',
	'cleanTruncatedProse',
	'readBack',
	'splitNode'
];

/** Whether `code` calls a store taker, by its own name or by a name it imports it as. */
function handsOnAStore(code: string): boolean {
	const aliases = [...code.matchAll(/\b(\w+)\s+as\s+(\w+)/g)]
		.filter(([, name]) => STORE_TAKERS.includes(name))
		.map(([, , alias]) => alias);
	const names = [...STORE_TAKERS, ...aliases].join('|');
	return new RegExp(`(?<![\\w$.])(?<!function\\s)(?:${names})\\s*\\(`).test(code);
}

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

	it('matches a store taker called by a name it was imported as', () => {
		expect(handsOnAStore("import { splitNode as cut } from './x';\ncut(a);")).toBe(true);
		expect(handsOnAStore("import { cut } from './x';\ncut(a);")).toBe(false);
	});

	it('every file that hands a store on is a family’s, or a rewrite', () => {
		const found = sources.filter((file) => handsOnAStore(file.code)).map((f) => inLib(f.relPath));
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
