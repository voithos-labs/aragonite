// @vitest-environment jsdom
// G1.199: every route that removes a range leaves the range-edit core's bytes, a cut writes the
// core's copy, and one undo gives the source back; G1.200: its caret is the core's, as landed.
// Miss-analysis: the copy and the delete each had suites of their own, and none ran every removal
// route over one range against the answer they all share.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PresentationMode } from '#lib/presentation-mode.js';
import type { Document } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { cellPoint, type EditorSelection } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { documentBytes, removalBytes, wholeBlockBytes } from '#lib/selection/range-bytes.js';
import { gapEligibleAt, type GapCaretPosition } from '#lib/selection/gap-caret.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { leafAtByte } from '#lib/tree-operations/container-offsets.js';
import { allBlockPaths } from '../invariants/arbitraries/index';
import {
	removalOf,
	wholeBlocksRemovalOf,
	type RangeEditResult,
	type RemovalGesture as CoreGesture
} from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { rangeClipboard } from '#lib/selection/range-clipboard.js';
import { caretTargetFor, type RemovalGesture } from '#lib/selection/caret-target.js';
import { CORE_GESTURE } from '#lib/selection/cross-block/range-removal.js';
import type { SpliceCaret } from '#lib/action-contracts.js';
import { landingAt } from '#lib/editor-actions/commit/byte-splice.js';
import { CURSOR_END, CURSOR_START } from '#lib/block-component.js';
import { caretOf } from './through-splice';
import { registerDefaultContextActions } from '#lib/components/menu/default-context-actions.js';
import {
	destroyMountedEditors,
	installLayoutStubs
} from '#lib/test/harness/mount-editor.svelte.js';
import {
	installClipboardEvents,
	installSystemClipboard
} from '#lib/test/harness/clipboard-events.js';
import { pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import { fixtureReading } from '#lib/test/harness/fixture-grammar.js';
import { deleteRange } from '#lib/test/harness/range-delete.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	CLIPBOARD_ROUTES,
	blocksIn,
	clipboardGesture,
	kitFixtures,
	mountCase,
	placeRange,
	runHistory,
	Undetermined,
	type Editor
} from './gestures';
import { measured } from '#lib/tree-operations/top-level-starts.js';

beforeAll(installLayoutStubs);
beforeEach(() => {
	installClipboardEvents();
	installSystemClipboard();
	registerDefaultContextActions();
});
afterEach(async () => {
	await destroyMountedEditors();
	takeDevWarns();
});

interface Shape {
	source: string;
	select: EditorSelection;
	/** The core's caret is a boundary for every route that takes the range forward. */
	boundaryForward?: true;
}

const at = (path: number[], offset: number) => ({ path, offset });
const range = (anchor: Shape['select']['anchor'], focus: Shape['select']['focus']) => ({
	anchor,
	focus
});

/** The shapes each removal once parted on: a copy and a delete that disagreed, a fence a range
 *  enters or leaves, a title row, a list the range joins into. */
const SHAPES: Record<string, Shape> = {
	'two paragraphs': {
		source: 'alpha bravo\n\ncharlie delta\n',
		select: range(at([0], 6), at([1], 8))
	},
	'out of a table': {
		source: '| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n',
		select: range(cellPoint([0], 2), at([1], 3))
	},
	'from a title row out': {
		source: '<details open>\n<summary>OOOO</summary>\n\nPPPP\n\n</details>\n\nAAAA\n',
		select: range(at([0, 0], 1), at([1], 2))
	},
	'onto a title row': {
		source: 'MMMM\n\n<details>\n<summary>SSSS</summary>\n\nHHHH\n\n</details>\n',
		select: range(at([0], 1), at([1, 0], 0))
	},
	'through a heading': { source: 'a\n# h\nb\n', select: range(at([0], 0), at([1], 3)) },
	'a quote into a nested list': {
		source: '> word\n1. n\n> - x\n\n-\t- x\n',
		select: range(at([0, 0], 0), at([2, 0, 0, 0], 1))
	},
	'back onto a callout title': {
		source: ':::callout Title\na\n:::\n',
		select: range(at([0, 1], 1), at([0, 0], 0))
	},
	'back into a code block': { source: '```\nx\n```\nb\n', select: range(at([1], 1), at([0], 5)) },
	'out of a math block past its closer': {
		source: '$$\nx\n$$\n\nbb\n',
		select: range(at([0], 4), at([1], 1))
	},
	'out of a code block past its closer': {
		source: '```\nx\n```\n\nbb\n',
		select: range(at([0], 5), at([1], 1))
	},
	'from a list item into the item a math block opens': {
		source: '- a\n- b\n\n  $$\n  y\n  $$\n',
		select: range(at([0, 0, 0], 0), at([0, 1, 0], 1))
	},
	'across ordered items, which number on': {
		source: '1. one\n2. two\n3. three\n',
		select: range(at([0, 0, 0], 1), at([0, 1, 0], 1))
	},
	'out of a format run': {
		source: '**bold text**\n\nafter\n',
		select: range(at([0], 4), at([1], 2))
	},
	// Miss-analysis: no shape left the caret in a block that opens its source where the caret lands.
	'out of a one-line math block, its source opening on the caret': {
		source: 'Before\n\n$$x^2$$\n\nAfter\n',
		select: range(at([1], 2), at([2], 0))
	},
	'out of a math block': {
		source: 'Before\n\n$$\nx^2\n$$\n\nAfter\n',
		select: range(at([1], 4), at([2], 0))
	},
	// Miss-analysis: no shape left a gap caret two containers deep, where the walk from a byte and
	// the laws' reading of the caret back each added a container's raw length to a document byte.
	'from code in a quote in a quote out to the paragraph after': {
		source: '> > ```\n> > x\n> > ```\n> >\n> > ~~~\n> > y\n> > ~~~\n\nafter',
		select: range(at([0, 0, 1], 0), at([1], 5)),
		boundaryForward: true
	}
};

type Route =
	{ key: 'Backspace' | 'Delete'; ctrl: boolean } | { cut: (typeof CLIPBOARD_ROUTES)[number] };

const ROUTES: Record<string, Route> = {
	Backspace: { key: 'Backspace', ctrl: false },
	Delete: { key: 'Delete', ctrl: false },
	'Ctrl+Backspace': { key: 'Backspace', ctrl: true },
	'Ctrl+Delete': { key: 'Delete', ctrl: true },
	...Object.fromEntries(CLIPBOARD_ROUTES.map((r) => [`cut by ${r}`, { cut: r }]))
};

/** The core's answer for the range the editor holds: its bytes and, for a cut, its copy. */
function coreAnswer(editor: Editor, mode: PresentationMode, gesture: RemovalGesture) {
	const grammar = editor.instance.__test.getGrammar();
	const reading = fixtureReading({ grammar }, mode);
	const doc = readAsOpened(editor.source(), { grammar, scope: 'document' }) as Document;
	const held = editor.instance.getSelection()!;
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(held.anchor, held.focus);
	const { start, end } = selection;
	const coverage = rangeCoverage(doc, coverRange(doc, start!, end!));
	const bytes = documentBytes({
		version: () => 0,
		doc: () => doc,
		source: () => serialize(doc),
		measured: () => measured(doc),
		vouch: () => true
	});
	const copy = rangeClipboard(bytes, coverage, reading)?.text ?? '';
	const { removed } = deleteRange(doc, start!, end!, { reading, gesture });
	return { source: serialize(doc), copy, caret: removed.landed! };
}

const heldCaret = (e: Editor) =>
	JSON.stringify([e.instance.getSelection(), e.instance.__test.getGapCaret()]);

/** The caret a route left, read back right after it, over the bytes it left. */
const leftBy = (editor: Editor) => ({
	held: heldCaret(editor),
	byte: caretOf(editor),
	source: editor.source()
});

/** A route's caret against where a byte splice puts the core's: a boundary as the gap caret, else
 *  in a fresh editor over the same bytes, so a block that opened its source opens it again. */
async function expectCoreCaret(
	left: ReturnType<typeof leftBy>,
	caret: SpliceCaret,
	mode: PresentationMode
): Promise<void> {
	if (caret.holds === 'boundary') {
		expect(left.byte, 'the core’s caret').toEqual(caret);
		return;
	}
	const fresh = mountCase(left.source, mode);
	await fresh.settle();
	const doc = fresh.instance.__test.getDocument();
	const landing = landingAt(measured(doc), caret)!;
	if ('anchor' in landing) await fresh.instance.setSelection(landing);
	else if (!('gapCaret' in landing)) {
		const target = caretTargetFor(doc, landing)!;
		fresh.instance.__test.getBlockComponent([...target.leafPath])!.focus(target.offset);
	}
	await fresh.settle();
	expect(left.held, 'the core’s caret').toBe(heldCaret(fresh));
}

async function drive(editor: Editor, route: Route): Promise<string | null> {
	if ('cut' in route) return (await clipboardGesture(editor, 'cut', route.cut))['text/plain'] ?? '';
	const el = (document.activeElement as HTMLElement | null) ?? document.body;
	const took = await pressHardwareKey(el, { key: route.key, ctrlKey: route.ctrl });
	await editor.settle();
	return took === 'browser' ? null : '';
}

describe('every removal route leaves the core’s bytes', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const [shape, { source, select, boundaryForward }] of Object.entries(SHAPES)) {
			it.each(Object.entries(ROUTES))(`${mode}, ${shape}: %s`, async (_, route) => {
				const editor = mountCase(source, mode);
				await editor.settle();
				expect(await placeRange(editor, select), 'the range would not place').toBe(true);
				const gesture: RemovalGesture = 'cut' in route ? 'cut' : route.key;
				const want = coreAnswer(editor, mode, gesture);
				if (boundaryForward && gesture !== 'Backspace')
					expect(want.caret.holds, 'the core’s caret').toBe('boundary');
				let wrote: string | null;
				try {
					wrote = await drive(editor, route);
				} catch (e) {
					if (e instanceof Undetermined) return;
					throw e;
				}
				expect(wrote, 'the browser would have handled the key').not.toBeNull();
				expect(editor.source()).toBe(want.source);
				if ('cut' in route) expect(wrote).toBe(want.copy);
				const left = leftBy(editor);
				await runHistory(editor, 'undo');
				expect(editor.source(), 'one undo').toBe(source);
				await expectCoreCaret(left, want.caret, mode);
			});
		}
	}
});

// ── A block removed whole ────────────────────────────────────────────────────

/** The blocks each whole-block route removes: a rule a focused block's keys reach, top-level, in a
 *  quote and as the last block, and blocks only the menu offers its Delete on. */
const WHOLE: Record<string, { source: string; path: number[]; keys: boolean; menu: boolean }> = {
	'a rule between paragraphs': { source: 'a\n\n---\n\nb\n', path: [1], keys: true, menu: true },
	'a rule in a quote': { source: '> a\n>\n> ---\n>\n> b\n', path: [0, 1], keys: true, menu: false },
	'a rule ending the document': { source: 'a\n\n---', path: [1], keys: true, menu: true },
	'a code block': { source: 'a\n\n```\nx\n```\n\nb\n', path: [1], keys: false, menu: true },
	'a rule in an ordered list item': {
		source: '1. one\n\n   ---\n\n   two\n2. three\n',
		path: [0, 0, 1],
		keys: true,
		menu: false
	}
};

type WholeRoute = { key: 'Backspace' | 'Delete' } | { cut: true } | { menu: true };

const WHOLE_ROUTES: Record<string, WholeRoute> = {
	'Backspace on the block focused whole': { key: 'Backspace' },
	'Delete on the block focused whole': { key: 'Delete' },
	'Mod+X on the block focused whole': { cut: true },
	'the block menu’s Remove': { menu: true }
};

/** The core's answer for the block at `path` removed whole by `route`. */
function wholeAnswer(editor: Editor, mode: PresentationMode, path: number[], route: WholeRoute) {
	const grammar = editor.instance.__test.getGrammar();
	const reading = fixtureReading({ grammar }, mode);
	const source = editor.source();
	const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
	const laid = measured(doc);
	const layout = documentLayout(laid);
	const range = wholeBlockBytes(doc, layout, path)!;
	const host = rangeHost(reading, { source, measured: laid, layout });
	const core = mode === 'live' ? 'live' : 'source';
	const gesture: RemovalGesture = 'menu' in route ? 'keyless' : 'cut' in route ? 'cut' : route.key;
	return wholeBlocksRemovalOf(source, range, CORE_GESTURE[gesture], core, host);
}

async function driveWhole(editor: Editor, path: number[], route: WholeRoute): Promise<boolean> {
	editor.instance.__test.getBlockComponent(path)!.focus(0);
	await editor.settle();
	const el = document.activeElement as HTMLElement;
	if ('menu' in route) {
		el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		await editor.settle();
		const row = [
			...document.querySelectorAll<HTMLButtonElement>('.md-menu [role="menuitem"]')
		].find((r) => r.textContent?.trim().startsWith('Remove'));
		row?.click();
		await editor.settle();
		return row !== undefined;
	}
	const init = 'cut' in route ? { key: 'x', ctrlKey: true } : { key: route.key };
	const took = await pressHardwareKey(el, init);
	await editor.settle();
	await editor.settle();
	return took !== 'browser';
}

describe('every whole-block route leaves the core’s bytes', () => {
	for (const mode of ['source', 'live'] as const) {
		for (const [shape, { source, path, keys, menu }] of Object.entries(WHOLE)) {
			const routes = Object.entries(WHOLE_ROUTES).filter(([, r]) => ('menu' in r ? menu : keys));
			it.each(routes)(`${mode}, ${shape}: %s`, async (_, route) => {
				const editor = mountCase(source, mode);
				await editor.settle();
				const want = wholeAnswer(editor, mode, path, route);
				expect(await driveWhole(editor, path, route), 'the route took no action').toBe(true);
				expect(editor.source()).toBe(want.source);
				const left = leftBy(editor);
				await runHistory(editor, 'undo');
				expect(editor.source(), 'one undo').toBe(source);
				await expectCoreCaret(left, want.caret, mode);
			});
		}
	}
});

// Miss-analysis: the core's caret table holds every kit kind's byte, and R1 each route's landing of
// it, but nothing held that byte, landed, to where the kind itself puts a caret it is entered at.
describe('a rule removed whole lands where the kind beside it takes a caret, or in the gap', () => {
	// `gap`: the kinds a route leaves the gap above, where the core names the boundary the rule
	// left and a letter there would go into the kind's syntax.
	const sides = {
		'above the rule, by Backspace': { route: { key: 'Backspace' }, above: true, gap: [] },
		'above the rule, by the block menu’s Remove': { route: { menu: true }, above: true, gap: [] },
		'below the rule, by Delete': { route: { key: 'Delete' }, above: false, gap: [] },
		'below the rule, by Mod+X': { route: { cut: true }, above: false, gap: ['fencedCode'] }
	} satisfies Record<string, { route: WholeRoute; above: boolean; gap: string[] }>;
	for (const mode of ['source', 'live'] as const) {
		it.each(Object.entries(sides))(`${mode}, every kit kind %s`, async (_, side) => {
			const { route, above } = side;
			const out: string[] = [];
			const gaps: string[] = [];
			const kits = await kitFixtures();
			expect(kits.map(([kind]) => kind)).toContain('table');
			for (const [kind, fixture] of kits) {
				await destroyMountedEditors();
				const block = fixture.replace(/\r?\n$/, '');
				const source = above ? `${block}\n\n---\n\nbelow\n` : `above\n\n---\n\n${block}\n`;
				const editor = mountCase(source, mode);
				await editor.settle();
				if (editor.instance.__test.getDocument().children.length !== 3) continue;
				if (mode === 'live' && !above && TITLE_ROW_KINDS.has(kind)) continue;
				if (!(await driveWhole(editor, [1], route))) out.push(`${kind}: the route took no action`);
				const removed = editor.source();
				const held = editor.instance.__test.getGapCaret()?.held;
				const left = { caret: heldCaret(editor), typed: await typedAt(editor) };
				if (held) {
					gaps.push(kind);
					const own = above ? `${block}\n\nx\n\nbelow\n` : `above\n\nx\n\n${block}\n`;
					if (left.typed !== own) out.push(`${kind}: ${left.typed}`);
					continue;
				}
				const fresh = mountCase(removed, mode);
				await fresh.settle();
				fresh.instance.__test.getBlockComponent(above ? [0] : [1])!.focus(edge(above));
				await fresh.settle();
				const own = { caret: heldCaret(fresh), typed: await typedAt(fresh) };
				// Two raw offsets of one screen position, as live mode's hidden markers make, are one place.
				if (left.caret !== own.caret && left.typed !== own.typed)
					out.push(`${kind}: ${left.caret}, not ${own.caret}`);
			}
			expect(out).toEqual([]);
			expect(gaps, 'the kinds the gap is held above').toEqual(side.gap);
		});
	}
});

const edge = (above: boolean) => (above ? CURSOR_END : CURSOR_START);

// A live title row's own start caret reads raw 0, before its hidden `:::` marker, so a letter goes
// in front of the marker; the removal's caret types into the title, where Delete means it.
const TITLE_ROW_KINDS = new Set(['directiveContainer', 'directiveLeaf', 'admonition']);

/** The source once a letter is typed at the editor's caret, read before the editor loses focus. */
async function typedAt(editor: Editor): Promise<string> {
	const before = editor.source();
	await pressHardwareKey(document.activeElement as HTMLElement, { key: 'x' });
	await editor.settle();
	const typed = editor.source();
	return typed === before ? 'nothing typed' : typed;
}

// ── The place the core names ─────────────────────────────────────────────────

type Lines = string[];
const quoted = (body: Lines) => body.map((l) => (l === '' ? '>' : `> ${l}`));
const itemOf = (body: Lines) => body.map((l, i) => (i === 0 ? `- ${l}` : l === '' ? '' : `  ${l}`));
const WRAPS: Record<string, (body: Lines) => Lines> = {
	quote: quoted,
	'list item': itemOf,
	callout: (body) => ['> [!NOTE]', ...quoted(body)],
	directive: (body) => [':::note', ...body, ':::'],
	// Open, since a closed body mounts nothing a caret could sit in.
	details: (body) => ['<details open>', '<summary>S</summary>', '', ...body, '', '</details>']
};
const nest = (wrap: (body: Lines) => Lines, depth: number, body: Lines): Lines =>
	depth === 0 ? body : nest(wrap, depth - 1, wrap(body));

const pathsOf = (doc: Document, kind: string) =>
	allBlockPaths(doc).filter((path) => blockNodeAt(doc, path)!.kind === kind);

type Take = EditorSelection | { whole: number[] };

/** The top-level rule a shape removes whole; null where the wrapper's own closing line takes it. */
const topRule = (doc: Document): Take | null => {
	const rule = pathsOf(doc, 'thematicBreak').find((path) => path.length === 1);
	return rule ? { whole: rule } : null;
};

/** The deepest rule, removed whole. */
const innerRule = (doc: Document): Take | null => {
	const rule = pathsOf(doc, 'thematicBreak').at(-1);
	return rule ? { whole: rule } : null;
};

/** Where two boundaries meet on one byte, or a removal empties the line above a block: the
 *  removal's caret must sit among the children of the block the core names, two deep or one. */
const PLACE_SHAPES: Record<
	string,
	{
		lines: (wrap: (b: Lines) => Lines, d: number) => Lines;
		take: (doc: Document) => Take | null;
		unended?: true;
	}
> = {
	'a rule under them': {
		lines: (wrap, d) => [...nest(wrap, d, ['| b |', '| - |']), '---'],
		take: topRule,
		unended: true
	},
	'a rule under them, ended': {
		lines: (wrap, d) => [...nest(wrap, d, ['| b |', '| - |']), '---'],
		take: topRule
	},
	'a rule under them, text below': {
		lines: (wrap, d) => [...nest(wrap, d, ['| b |', '| - |']), '---', '', 'after'],
		take: topRule
	},
	'a cut across two fences': {
		lines: (wrap, d) => [...nest(wrap, d, ['```', 'x', '```', '~~~', 'y', '~~~']), '', 'after'],
		take: (doc) => {
			const [first, second] = pathsOf(doc, 'fencedCode');
			return range(at(first, 0), at(second, blockNodeAt(doc, second)!.raw.indexOf('y') + 1));
		}
	},
	// The item ends on a tight item's first byte, and the caret the core names is the end of the
	// table's last line, where no block starts or ends.
	'a rule ending them after a table, a tight item below': {
		lines: (wrap, d) => [...itemOf(nest(wrap, d, ['a', '', '| b |', '| - |', '', '---'])), '- c'],
		take: innerRule
	},
	// The core names the directive the range started in, and its byte sits inside the callout.
	'from a title row into a fence in a callout': {
		lines: (wrap, d) => [
			...nest(wrap, d, [
				':::note',
				'> [!NOTE]',
				'> ```',
				'> x',
				'> ```',
				'> ~~~',
				'> y',
				'> ~~~',
				':::'
			]),
			'',
			'after'
		],
		take: (doc) => {
			const title = pathsOf(doc, 'directiveOpenerLine').at(-1);
			const code = pathsOf(doc, 'fencedCode')[0];
			if (!title || !code) return null;
			const end = blockNodeAt(doc, title)!.raw.replace(/\r?\n$/, '').length;
			return range(at(title, end), at(code, blockNodeAt(doc, code)!.raw.indexOf('x') + 1));
		}
	}
};

type PlaceRoute = 'Backspace' | 'Delete' | 'Mod+X' | 'a letter';
const PLACE_ROUTES: PlaceRoute[] = ['Backspace', 'Delete', 'Mod+X', 'a letter'];

/** The core's caret for `route` over what `take` names, as the route hands it over. */
function corePlace(editor: Editor, mode: PresentationMode, take: Take, route: PlaceRoute) {
	const grammar = editor.instance.__test.getGrammar();
	const source = editor.source();
	const doc = readAsOpened(source, { grammar, scope: 'document' }) as Document;
	const laid = measured(doc);
	const layout = documentLayout(laid);
	const host = rangeHost(fixtureReading({ grammar }, mode), { source, measured: laid, layout });
	const core = mode === 'live' ? 'live' : 'source';
	const gesture: CoreGesture =
		route === 'a letter'
			? 'type'
			: route === 'Mod+X'
				? 'cut'
				: route === 'Delete'
					? 'delete'
					: 'backspace';
	if ('whole' in take)
		return wholeBlocksRemovalOf(
			source,
			wholeBlockBytes(doc, layout, take.whole)!,
			gesture,
			core,
			host
		);
	const held = editor.instance.getSelection()!;
	const selection = createSelectionState({ getDoc: () => doc });
	selection.enterCrossBlock(held.anchor, held.focus);
	const coverage = rangeCoverage(doc, coverRange(doc, selection.start!, selection.end!));
	if (route === 'a letter')
		return removalOf(source, removalBytes(doc, coverage, layout)!, gesture, core, host);
	// As the byte splice writes it, a closer under an opener the removal leaves included.
	const reading = fixtureReading({ grammar }, mode);
	const removal: RemovalGesture = route === 'Mod+X' ? 'cut' : route;
	const { removed } = deleteRange(doc, selection.start!, selection.end!, {
		reading,
		gesture: removal
	});
	return { source: serialize(doc), caret: removed.landed as RangeEditResult['caret'] };
}

/** What a removal's caret is held as: the gap a boundary names, marked where no arrow stops at
 *  it, or no gap where a paragraph's own text takes the letter (or the caret names no boundary). */
function heldAs(doc: Document, caret: RangeEditResult['caret']): GapCaretPosition | null {
	const named = namedBoundary(doc, caret);
	if (!named || gapEligibleAt(doc, named.parentPath, named.index)) return named;
	const rootEnd = named.parentPath.length === 0 && named.index === doc.children.length;
	const text = leafAtByte(measured(doc), caret.at);
	if (!rootEnd && text && blockNodeAt(doc, text.path)?.kind === 'paragraph') return null;
	return { ...named, held: true };
}

/** The boundary a caret names: among its parent's children, before the first whose own bytes
 *  start at or past its byte, else after the last; null for a caret on text or on a block. */
function namedBoundary(doc: Document, caret: RangeEditResult['caret']): GapCaretPosition | null {
	if (caret.holds !== 'boundary') return null;
	// A table's rows, or a path holding no blocks, stand for the container around them.
	let parentPath = [...caret.parent];
	const holds = (path: number[]) => {
		const node = path.length === 0 ? doc : blockNodeAt(doc, path);
		return !!node?.children?.length && !('raw' in node && node.kind === 'table');
	};
	while (parentPath.length > 0 && !parentPath.every((_, i) => holds(parentPath.slice(0, i + 1))))
		parentPath = parentPath.slice(0, -1);
	const layout = documentLayout(measured(doc));
	for (;;) {
		const children = (parentPath.length === 0 ? doc : blockNodeAt(doc, parentPath))?.children ?? [];
		let index = children.findIndex((_, k) => layout.block([...parentPath, k])!.from >= caret.at);
		if (index < 0) index = children.length;
		// A byte inside the child before, ahead of one of its own children, names a boundary among them.
		const inside = layout.block([...parentPath, index - 1]);
		const own = inside && holds(inside.path) ? blockNodeAt(doc, inside.path)!.children! : [];
		const last = own.length > 0 ? layout.block([...inside!.path, own.length - 1]) : undefined;
		if (inside && last && inside.from < caret.at && last.from >= caret.at) {
			parentPath = inside.path;
			continue;
		}
		return { parentPath, index };
	}
}

/** Whether a paragraph holding only the typed letter stands at `path`. */
const letterAt = (editor: Editor, path: readonly number[]) =>
	/^q\r?\n?$/.test(blockNodeAt(editor.instance.__test.getDocument(), path)?.raw ?? '');

async function drivePlace(editor: Editor, take: Take, route: PlaceRoute): Promise<boolean> {
	if ('whole' in take) {
		if (route === 'a letter') return false;
		return driveWhole(editor, take.whole, route === 'Mod+X' ? { cut: true } : { key: route });
	}
	if (!(await placeRange(editor, take))) return false;
	if (route === 'Mod+X') return (await drive(editor, { cut: 'key' })) !== null;
	const key = route === 'a letter' ? 'q' : route;
	return (await pressHardwareKey(document.activeElement as HTMLElement, { key })) !== 'browser';
}

// Miss-analysis: every landing row read the core's caret back by its byte alone, and no row put
// two boundaries on one byte, so a caret that left the block the core named went unseen.
describe('a removal’s caret sits among the children of the block the core names', () => {
	const rows = Object.entries(PLACE_SHAPES).flatMap(([shape, spec]) =>
		Object.entries(WRAPS).flatMap(([wrap, fn]) =>
			[1, 2, 3].flatMap((depth) =>
				['\n', '\r\n'].map((eol) => ({
					shape,
					depth,
					wrap,
					ending: eol === '\n' ? 'LF' : 'CRLF',
					source: spec.lines(fn, depth).join(eol) + (spec.unended ? '' : eol),
					take: spec.take
				}))
			)
		)
	);
	for (const mode of ['source', 'live'] as const) {
		for (const route of PLACE_ROUTES) {
			const title = `${mode}, ${route}: $shape, $depth deep in a $wrap, $ending`;
			it.each(rows)(title, async ({ shape, wrap, source, take }) => {
				// In live mode a code block the caret lands in with no body line writes one on arrival
				// (`CodeBlock.svelte` :: `bareFenceCompletion`), a byte the core's answer doesn't hold.
				const diverges =
					mode === 'live' &&
					shape === 'a cut across two fences' &&
					((route === 'Delete' && (wrap === 'callout' || wrap === 'details')) ||
						(route !== 'Backspace' && route !== 'a letter' && wrap === 'directive'));
				if (diverges) return;
				const editor = mountCase(source, mode);
				await editor.settle();
				const target = take(editor.instance.__test.getDocument());
				// A wrapper whose closing line the rule reads into leaves no such block to take.
				if (!target || ('whole' in target && route === 'a letter')) return;
				if (!('whole' in target))
					expect(await placeRange(editor, target), 'the range would not place').toBe(true);
				const want = corePlace(editor, mode, target, route);
				expect(await drivePlace(editor, target, route), 'the route took no action').toBe(true);
				await editor.settle();
				if (route !== 'a letter') expect(editor.source(), 'the core’s bytes').toBe(want.source);
				const doc = readAsOpened(want.source, {
					grammar: editor.instance.__test.getGrammar(),
					scope: 'document'
				}) as Document;
				if ('whole' in target && want.caret.holds === 'boundary')
					expect(want.caret.parent, 'the block the rule sat among').toEqual(
						target.whole.slice(0, -1)
					);
				const gap = heldAs(doc, want.caret);
				const opens = gap && [...gap.parentPath, gap.index];
				if (route === 'a letter') {
					if (opens) expect(letterAt(editor, opens), editor.source()).toBe(true);
					return;
				}
				expect(editor.instance.__test.getGapCaret(), 'the gap caret').toStrictEqual(gap);
				if (want.caret.holds !== 'boundary') return;
				await pressHardwareKey(document.activeElement as HTMLElement, { key: 'q' });
				await editor.settle();
				if (opens) expect(letterAt(editor, opens), editor.source()).toBe(true);
				if ('whole' in target) return;
				// The key and then a letter leave what the letter typed over the range leaves.
				const over = mountCase(source, mode);
				await over.settle();
				expect(await drivePlace(over, target, 'a letter'), 'no letter went over').toBe(true);
				await over.settle();
				expect(blocksIn(editor), 'the letter typed over the range').toEqual(blocksIn(over));
			});
		}
	}
});
