// Miss-analysis: every table fixture ended in a line break, so no test saw the table rebuild
// give the document's last line an ending it never had.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { makeHarness, runOp, type Op } from '$lib/test/undo/restoration-ops';

const TABLE = '| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |';

// Every table edit rebuilds the table's bytes, so each must leave the open last line open.
const EDITS: Array<[name: string, op: Op, after: string]> = [
	[
		'a row moved onto the last line',
		{ t: 'tableReorderRow', i: 1, dir: 1 },
		'| h1 | h2 |\n| --- | --- |\n| c | d |\n| a | b |'
	],
	[
		'the last row moved up',
		{ t: 'tableReorderRow', i: 2, dir: -1 },
		'| h1 | h2 |\n| --- | --- |\n| c | d |\n| a | b |'
	],
	[
		'a column moved right',
		{ t: 'tableReorderColumn', i: 0, dir: 1 },
		'| h2 | h1 |\n| --- | --- |\n| b | a |\n| d | c |'
	],
	[
		'a column moved left',
		{ t: 'tableReorderColumn', i: 1, dir: -1 },
		'| h2 | h1 |\n| --- | --- |\n| b | a |\n| d | c |'
	],
	[
		'a row inserted below the last',
		{ t: 'tableInsertRow', i: 2 },
		'| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |\n|  |  |'
	],
	['the last row deleted', { t: 'tableDeleteRow', i: 2 }, '| h1 | h2 |\n| --- | --- |\n| a | b |'],
	[
		'a column inserted',
		{ t: 'tableInsertColumn', i: 1 },
		'| h1 | h2 |  |\n| --- | --- | --- |\n| a | b |  |\n| c | d |  |'
	],
	[
		'an alignment cycled',
		{ t: 'tableCycleAlignment', i: 0 },
		'| h1 | h2 |\n| :---: | --- |\n| a | b |\n| c | d |'
	],
	[
		'a last-row cell typed into',
		{ t: 'typeCell', r: 2, c: 1, n: 0 },
		'| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | dz |'
	]
];

describe('a table ending the document with no final line break', () => {
	it.each(EDITS)('%s keeps the last line open', async (_name, op, after) => {
		const h = makeHarness(TABLE);
		await runOp(h, op);
		expect(serialize(h.deps.doc)).toBe(after);
	});

	it('a header-only table keeps its delimiter line open', async () => {
		const h = makeHarness('| h1 | h2 |\n| --- | --- |');
		await runOp(h, { t: 'tableCycleAlignment', i: 1 });
		expect(serialize(h.deps.doc)).toBe('| h1 | h2 |\n| --- | :---: |');
	});

	it('a moved row in a terminated table keeps the final line break', async () => {
		const h = makeHarness(TABLE + '\n');
		await runOp(h, { t: 'tableReorderRow', i: 2, dir: -1 });
		expect(serialize(h.deps.doc)).toBe('| h1 | h2 |\n| --- | --- |\n| c | d |\n| a | b |\n');
	});
});
