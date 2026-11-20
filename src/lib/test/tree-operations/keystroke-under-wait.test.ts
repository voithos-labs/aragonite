// @vitest-environment jsdom
// A definition whose title has started waits on the lines under it, so a key in a block below it
// can change the definition. Every route a key takes leaves the tree a reload of its bytes reads.
// Miss-analysis: the fix-up's rows put a closer under an opener a line closes; none put a key under
// a reading no line closes, where the block it changes stands several blocks above the key.
import { describe, it, expect, beforeEach } from 'vitest';
import type { BlockEditActions } from '#lib/action-contracts.js';
import type { CstNode } from '#lib/core/nodes.js';
import { installPlugins } from '#lib/schema/plugin-install.js';
import {
	EDITS,
	harnessOver,
	judge,
	leafAt,
	opened,
	type Edit
} from '#lib/test/exhaustive/edit-driver.js';
import { endTypingBatchesForTests } from '#lib/editor-actions/commit/text-batch.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { ALPHABET_PLUGINS } from '#lib/test/exhaustive/alphabet.js';
import fc from 'fast-check';
import { changesBetween } from '#lib/tree-operations/byte-changes.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { pointAtByte } from '#lib/selection/range-bytes.js';
import {
	arbWaitingDefinitionEdit,
	wrapped,
	type Wrap
} from '../invariants/arbitraries/waiting-definition';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

const typed = (text: string): Edit => ({
	name: `type ${JSON.stringify(text)}`,
	apply: async (blockEdit: BlockEditActions, index: number, node: CstNode, offset: number) =>
		blockEdit.updateBlockContent(
			index,
			node.raw.slice(0, offset) + text + node.raw.slice(offset),
			'authored',
			'join-typing',
			offset,
			offset + text.length
		)
});
const named = (name: string): Edit => EDITS.find((edit) => edit.name === name)!;
const BACKSPACE = named('delete before');
const DELETE = named('delete after');

const TAIL = ['', 'last'];
/** Where each wrap puts the blocks of the lines it is given. */
const LIST: Record<Wrap, number[]> = { top: [], quote: [0], item: [0, 0] };

/** A row: the lines, the block the key lands in, the text the caret stands after there (none for
 *  the block's start), and the key. */
type Row = [string, string[], number, string, Edit];

const closing = (open: string, close: string): Row[] => [
	[
		`${close} closes a title that started in a code line`,
		['[a]: /u', `    ${open}code`, '[b]: /v', '[b]: /v', 'end', ...TAIL],
		4,
		'end',
		typed(close)
	],
	[
		`${close} closes a title early, over lines a paragraph held`,
		['[a]: /u', `${open}t`, '[b]: /v', '[c]: /w', 'end', ...TAIL],
		1,
		`${open}t`,
		typed(close)
	]
];

const ROWS: Row[] = [
	...closing('"', '"'),
	...closing("'", "'"),
	...closing('(', ')'),
	[
		'a heading demoted under a started title',
		['[a]: /u', "    'code", '# h', 'text', "end'", ...TAIL],
		2,
		'# ',
		BACKSPACE
	],
	[
		'a letter that makes a heading a line of text',
		['[a]: /u', "    'code", '# h', 'text', "end'", ...TAIL],
		2,
		'',
		typed('-')
	],
	[
		'the quote that ended a title, deleted',
		['[a]: /u', '    "code', '[b]: /v', 'end"', ...TAIL],
		0,
		'end"',
		BACKSPACE
	],
	[
		'Backspace at the start of the block that ends the title',
		['[a]: /u', '    "code', 'text', '', 'end"', ...TAIL],
		3,
		'',
		BACKSPACE
	],
	[
		'Delete at the end of the block above the one that ends it',
		['[a]: /u', '    "code', 'text', '', 'end"', ...TAIL],
		2,
		'text',
		DELETE
	]
];

/** Enter inside a title that runs over lines: a row is the lines and the text the cut follows. */
const TITLES: [string, string[], string][] = [
	[
		'after the definition line, the title starting in code',
		['[a]: /u', "    'code", 'text', "end'"],
		'/u'
	],
	['after the code line the title starts in', ['[a]: /u', "    'code", 'text', "end'"], "'code"],
	['inside the title, at a line end', ['[a]: /u', "    'code", 'text', "end'"], 'text'],
	['after the definition line, the title on its own line', ['[a]: /u', '"title', 'more"'], '/u'],
	['after the line a title in parens starts on', ['[a]: /u', '(title', 'more)'], '(title']
];

beforeEach(() => installPlugins(ALPHABET_PLUGINS()));

describe('a key under a definition whose title has started', () => {
	for (const wrap of ['top', 'quote', 'item'] as const) {
		for (const eol of ['\n', '\r\n']) {
			const where = `${wrap}${eol === '\n' ? '' : ', CRLF'}`;
			it.each(ROWS)(`${where}: %s`, async (_, lines, block, after, edit) => {
				const source = wrapped(lines, wrap, eol);
				const path = [...LIST[wrap], block];
				const raw = leafAt(opened(source).children, path).raw;
				const offset = after === '' ? 0 : raw.indexOf(after) + after.length;

				expect(await judge(source, path, offset, edit)).toBeNull();
			});
		}
	}
});

/** A list or a table flush under the started title: the lines, the leaf, the text before the key. */
const CONTAINERS: [string, string[], number[], string][] = [
	['at the end of a list item', ['[a]: /u', '    "code', '2. item'], [2, 0, 0], 'item'],
	[
		'in an item, a lazy line under it',
		['[a]: /u', '    "code', '2. item', '   more'],
		[2, 0, 0],
		'item'
	],
	[
		'at the end of that lazy line',
		['[a]: /u', '    "code', '2. item', '   more'],
		[2, 0, 0],
		'more'
	],
	['in a table header cell', ['[a]: /u', '    "code', 'a | b', '- | -', 'c | d'], [2, 0, 1], 'b']
];

// Miss-analysis: the keystroke told an open draft it changes its own block and one either side,
// which held while no key could reach further up; no row typed with a draft open under a wait.
describe('a draft open while a key folds the blocks above it', () => {
	it('hears every block the key changed', async () => {
		const lines = ['[a]: /u', '    "code', '[b]: /v', '[b]: /v', 'end', ...TAIL];
		const h = harnessOver(opened(wrapped(lines, 'top', '\n')));
		Object.assign(h.deps.drafts, { watching: () => true });

		await h.blockEdit.updateBlockContent(4, 'end"\n', 'authored', 'join-typing', 3, 4);
		endTypingBatchesForTests();

		expect(h.deps.doc.children.map((node) => node.kind)).toEqual([
			'linkReferenceDefinition',
			'paragraph'
		]);
		expect(takeDevWarns().map((warn) => warn.tag)).toEqual([]);
	});
});

// Miss-analysis: a container's slot was asked for its joins only when its first or last line
// moved, and then as pairs, so a title that started above the container never saw the key.
describe('a quote typed in a container flush under a started title', () => {
	it.each(CONTAINERS)('%s', async (_, lines, path, after) => {
		const source = wrapped([...lines, ...TAIL], 'top', '\n');
		const raw = leafAt(opened(source).children, path).raw;

		expect(await judge(source, path, raw.indexOf(after) + after.length, typed('"'))).toBeNull();
	});
});

// Miss-analysis: every container row kept its list one block. None made the list give a line up,
// where the rebuild's own re-division and the look for a wait each wrote that line.
describe('a key that makes a list under a started title give a line up', () => {
	it('writes the line once', async () => {
		const lines = ['[a]: /u', "    'code", '2. two', '2. two', 'end', ...TAIL];

		expect(await judge(wrapped(lines, 'top', '\n'), [2, 1, 0], 0, typed('>'))).toBeNull();
	});
});

// Miss-analysis: every row whose list gave a line up had a blank line under it, so no row read the
// join between that line and the block flush below, here a list from 3 that can't start there.
describe('a key that makes a list give a line up over a list that cannot interrupt it', () => {
	const lines = ['[a]: /u', "'t", '- item', 'text', '    code', '3. three', 'end', ...TAIL];

	it.each<[string, number, Edit]>([
		['a quote mark before the item’s text', 0, typed('>')],
		['a line break typed after the item’s text', 4, typed('\n')],
		['a split after the item’s text', 4, named('split')]
	])('reads the line with what follows it: %s', async (_, offset, key) => {
		expect(await judge(wrapped(lines, 'top', '\n'), [2, 0, 0], offset, key)).toBeNull();
	});
});

// Miss-analysis: the split asked whether its halves rejoin with the second half's first line
// alone, so a title that closes two lines down never showed, and Enter wrote no byte.
describe('Enter inside a title that runs over lines writes its blank line', () => {
	for (const wrap of ['top', 'quote'] as const) {
		it.each(TITLES)(`${wrap}: %s`, async (_, lines, after) => {
			const source = wrapped([...lines, ...TAIL], wrap, '\n');
			const path = [...LIST[wrap], 0];
			const raw = leafAt(opened(source).children, path).raw;

			expect(
				await judge(source, path, raw.indexOf(after) + after.length, named('split'))
			).toBeNull();
		});
	}
});

/** The drawn change written into the leaf at the caret, as typing or deleting it would. */
const rewritten = (insert: string, removed: number): Edit => ({
	name: 'the drawn change',
	apply: async (blockEdit: BlockEditActions, index: number, node: CstNode, offset: number) =>
		blockEdit.updateBlockContent(
			index,
			node.raw.slice(0, offset) + insert + node.raw.slice(offset + removed),
			'authored',
			'join-typing',
			offset + removed,
			offset + insert.length
		)
});

const SEED = freshOrFixedSeed(20261112);

// Miss-analysis: the keystroke rows were named shapes; the drawn changes under a started title ran
// through the byte splice and the range host only, never as the keystroke that makes them.
describe('a drawn change under a started title, made as a keystroke', () => {
	it(`leaves the tree a reload reads, seed ${SEED}`, async () => {
		const out: string[] = [];
		let made = 0;
		for (const { before, after } of fc.sample(arbWaitingDefinitionEdit, {
			numRuns: 300,
			seed: SEED
		})) {
			const [{ from, to, insert }] = changesBetween(before, after);
			// A line taken whole is a removal across blocks, the range route's.
			if (before.slice(from, to).includes('\n') || insert.includes('\n')) continue;
			const doc = opened(before);
			const point = pointAtByte(measured(doc), from);
			// A change to a container's markers is no key in a block's text.
			const leaf = point && leafAt(doc.children, [...point.path]);
			if (
				!point ||
				leaf?.raw.slice(point.offset, point.offset + to - from) !== before.slice(from, to)
			)
				continue;
			made++;
			const failure = await judge(
				before,
				[...point.path],
				point.offset,
				rewritten(insert, to - from)
			);
			if (failure) out.push(`${JSON.stringify(before)} to ${JSON.stringify(after)}: ${failure}`);
		}
		expect(out).toEqual([]);
		expect(made).toBeGreaterThan(100);
	});
});
