// @vitest-environment jsdom
// A line filled or rewritten into a list item beside a list of the same type joins that list, at
// the document root and inside a quote, on every route that writes the line.
// Miss-analysis: the fill rows only asked whether the bytes reload as the tree, and two lists
// with a blank line between do, so nothing asked whether they should have been one.
import { describe, expect, it } from 'vitest';
import type { BlockEditActions } from '#lib/action-contracts.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { expectParseConverged } from '#lib/test/harness/parse-converged.js';
import { makeNestedHarness, makeTopHarness } from '../harness/editor-actions';
import { makeReorderHarness } from '../editor-actions/reorder-harness';

/** What the route leaves on the line: the typed route stops at the key that makes it a list. */
interface Route {
	item: string;
	/** The source with no blank line of its own, for a route that makes it first. */
	makesLine?: boolean;
	write(actions: BlockEditActions, index: number): Promise<unknown>;
}

const ROUTES: Record<string, Route> = {
	'typing the marker key by key': {
		item: '- ',
		async write(a, i) {
			await a.updateBlockContent(i, '-\n', 'authored', 'join-typing', 0, 1);
			await a.updateBlockContent(i, '- \n', 'authored', 'join-typing', 1, 2);
		}
	},
	'a write of the whole line': {
		item: '- [ ] start',
		write: (a, i) => a.updateBlockContent(i, '- [ ] start\n', 'authored', 'join-typing', 0, 11)
	},
	'a paste over the line': {
		item: '- [ ] start',
		write: (a, i) =>
			a.replaceBlock(
				i,
				parse('- [ ] start\n').children,
				{ replacementIndex: 0, offset: 11 },
				{ snapshotOffset: 0 }
			)
	},
	'a paragraph inserted, then written': {
		item: '- [ ] start',
		makesLine: true,
		async write(a, i) {
			await a.insertParagraph(i, '');
			await a.updateBlockContent(i, '- [ ] start\n', 'authored', 'join-typing', 0, 11);
		}
	}
};

/** Each shape's source with the blank line at block 1, and the bytes once `item` fills it. */
const SHAPES: Record<string, { source: string; joined: (item: string) => string }> = {
	'over a list': {
		source: 'intro\n\n\n- [ ] fold\n',
		joined: (item) => `intro\n\n${item}\n- [ ] fold\n`
	},
	'under a list': {
		source: '- [ ] fold\n\n\nafter\n',
		joined: (item) => `- [ ] fold\n${item}\n\nafter\n`
	},
	'between two lists': {
		source: '- [ ] a\n\n\n- [ ] b\n',
		joined: (item) => `- [ ] a\n${item}\n- [ ] b\n`
	}
};

const quoted = (bytes: string): string =>
	bytes
		.split('\n')
		.slice(0, -1)
		.map((line) => (line === '' ? '>' : `> ${line}`))
		.join('\n') + '\n';

/** The source as the route starts from it: one blank line between blocks, not two, when the route
 *  makes the line itself. */
const startOf = (source: string, route: Route): string =>
	route.makesLine ? source.replace('\n\n\n', '\n\n') : source;

function atRoot(source: string) {
	const h = makeTopHarness(source);
	return {
		actions: h.actions,
		bytes: () => serialize(h.deps.doc),
		doc: () => h.deps.doc,
		landings: h.landings,
		undo: createHistoryActions(h.deps, h.controller).requestUndo
	};
}

function inQuote(source: string) {
	const h = makeNestedHarness(quoted(source), { index: 0 });
	return {
		actions: h.bundle.blockEdit,
		bytes: () => serialize(h.deps.doc),
		doc: () => h.deps.doc
	};
}

describe.each(Object.keys(ROUTES))('%s', (routeName) => {
	const route = ROUTES[routeName];

	describe.each(Object.keys(SHAPES))('%s', (shapeName) => {
		const shape = SHAPES[shapeName];
		const joined = shape.joined(route.item);

		it('joins the list at the document root', async () => {
			const h = atRoot(startOf(shape.source, route));
			await route.write(h.actions, 1);
			expect(h.bytes()).toBe(joined);
			expectParseConverged(h.doc());
		});

		it('joins the list inside a quote', async () => {
			const h = inQuote(startOf(shape.source, route));
			await route.write(h.actions, 1);
			expect(h.bytes()).toBe(quoted(joined));
			expectParseConverged(h.doc());
		});
	});
});

describe('the caret after a join', () => {
	it('lands in the new item when the line folds into the list above it', async () => {
		const h = atRoot('- [ ] fold\n\n\nafter\n');
		await h.actions.updateBlockContent(1, '- [ ] start\n', 'authored', 'join-typing', 0, 11);
		expect(h.bytes()).toBe('- [ ] fold\n- [ ] start\n\nafter\n');
		expect(h.landings.at(-1)).toMatchObject({ leafPath: [0, 1, 0], offset: 'start'.length });
	});

	it('lands in the new item when the list below folds into the line', async () => {
		const h = atRoot('intro\n\n\n- [ ] fold\n');
		await h.actions.updateBlockContent(1, '- [ ] start\n', 'authored', 'join-typing', 0, 11);
		expect(h.landings.at(-1)).toMatchObject({ leafPath: [1, 0, 0], offset: 'start'.length });
	});

	it('lands in the new item when the typed marker folds the line into the list above', async () => {
		const h = atRoot('- [ ] fold\n\n\nafter\n');
		await ROUTES['typing the marker key by key'].write(h.actions, 1);
		expect(h.landings.at(-1)).toMatchObject({ leafPath: [0, 1, 0], offset: 0 });
	});

	it('lands in the new item when a paragraph with text turns into an item of the list above', async () => {
		const h = atRoot('- [ ] fold\n\nbuy milk\n');
		await h.actions.updateBlockContent(1, '- buy milk\n', 'authored', 'join-typing', 0, 2);
		expect(h.landings.at(-1)).toMatchObject({ leafPath: [0, 1, 0], offset: 0 });
	});
});

describe('one undo after a join', () => {
	it('gives back the blank line and both lists', async () => {
		const source = '- [ ] a\n\n\n- [ ] b\n';
		const h = atRoot(source);
		await h.actions.updateBlockContent(1, '- [ ] start\n', 'authored', 'join-typing', 0, 11);
		await h.undo();
		expect(h.bytes()).toBe(source);
	});
});

describe('which lines join and which stay apart', () => {
	it('stays apart when it fills as a paragraph', async () => {
		const h = atRoot('intro\n\n\n- [ ] fold\n');
		await h.actions.updateBlockContent(1, 'x\n', 'authored', 'join-typing', 0, 1);
		expect(h.bytes()).toBe('intro\n\nx\n\n- [ ] fold\n');
	});

	// Each pair reads as two lists in GFM whatever parts them, so a blank line keeps the editor
	// reading two as well.
	it.each([
		['an ordered item over a bullet list', '1. x', '- a'],
		['a `*` item over a `-` list', '* x', '- a'],
		['a `)` item over a `.` list', '1) x', '1. a']
	])('stays apart as %s', async (_label, item, list) => {
		const h = atRoot(`intro\n\n\n${list}\n`);
		await h.actions.updateBlockContent(1, `${item}\n`, 'authored', 'join-typing', 0, item.length);
		expect(h.bytes()).toBe(`intro\n\n${item}\n\n${list}\n`);
	});

	it('joins as a plain item beside a to-do list, since GFM reads both as bullet items', async () => {
		const h = atRoot('- [ ] fold\n\n\nafter\n');
		await h.actions.updateBlockContent(1, '- note\n', 'authored', 'join-typing', 0, 6);
		expect(h.bytes()).toBe('- [ ] fold\n- note\n\nafter\n');
	});

	it('joins as a paragraph with text turned into an item', async () => {
		const h = atRoot('- [ ] fold\n\nbuy milk\n');
		await h.actions.updateBlockContent(1, '- buy milk\n', 'authored', 'join-typing', 0, 2);
		expect(h.bytes()).toBe('- [ ] fold\n- buy milk\n');
	});

	it.each([
		['below it', '- a\n\n- c\n', 0, '- a\n- b\n\n- c\n'],
		['above it', '- c\n\n- a\n', 1, '- c\n\n- a\n- b\n']
	])(
		'stays apart when the list rewritten was already a list of the type %s',
		async (_label, source, index, expected) => {
			const h = atRoot(source);
			await h.actions.replaceBlock(index, parse('- a\n- b\n').children, undefined, {
				snapshotOffset: 0
			});
			expect(h.bytes()).toBe(expected);
		}
	);

	it('joins when a write changes a list to the type of the list above it', async () => {
		const h = atRoot('- c\n\n 1. a\n');
		await h.actions.updateBlockContent(1, '- a\n', 'authored', 'join-typing', 0, 3);
		expect(h.bytes()).toBe('- c\n- a\n');
	});

	// The commit settles again after the write's own pass, and that second pass must not join the
	// merged list to a list the edit never touched.
	it.each([
		['above', '- [ ] a\n\n- [ ] b\n\n\nafter\n', 2, '- [ ] a\n\n- [ ] b\n- \n\nafter\n'],
		['below', 'intro\n\n\n- [ ] b\n\n- [ ] c\n', 1, 'intro\n\n- \n- [ ] b\n\n- [ ] c\n']
	])('keeps an untouched list %s the joined one apart', async (_label, source, index, expected) => {
		const h = atRoot(source);
		await ROUTES['typing the marker key by key'].write(h.actions, index);
		expect(h.bytes()).toBe(expected);
	});

	it('stays apart when a paste puts a list after the text on a line', async () => {
		const h = atRoot('intro\n\n- [ ] fold\n');
		await h.actions.replaceBlock(0, parse('intro\n- [ ] x\n').children, undefined, {
			snapshotOffset: 0
		});
		expect(h.bytes()).toBe('intro\n- [ ] x\n\n- [ ] fold\n');
	});

	it('stays apart when a list is moved beside a list', async () => {
		const h = makeReorderHarness('- c\n\npara\n\n- x\n');
		await h.reorder.nudgeReorderUnit([2], -1);
		expect(serialize(h.doc)).toBe('- c\n\n- x\n\npara\n');
	});
});
