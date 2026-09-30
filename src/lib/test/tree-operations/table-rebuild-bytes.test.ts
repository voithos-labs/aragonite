// A table edit changes the bytes of the cells it edits and nothing else: untouched rows, the
// delimiter row and every other cell keep their padding.
// Miss-analysis: every table fixture was already canonical, so a rebuild that respelled every
// row wrote the bytes it had read and no test saw the rest of the table move.
import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { documentLineEnding } from '$lib/core/lines';
import type { CstNode } from '$lib/core/nodes';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { blockNodeAt } from '$lib/tree-operations/node-primitives';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { makeHarness, runOp, type Op } from '$lib/test/undo/restoration-ops';

/** `source` with the cell at `[row, column]` of its first table written to `text(raw)`, through
 *  the keystroke's in-place route. */
function writeCell(source: string, row: number, column: number, text: (raw: string) => string) {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	const leaf = [0, row, column];
	const owner = blockNodeAt(deps.doc, [0, row]) as CstNode;
	const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
	const write = legalizeWrite(body, column, text(owner.children![column].raw), 'authored');
	expect(typing.writeLeafInPlace(docPathFrom(leaf), write, 0).wrote).toBe(true);
	return deps.doc;
}

const typeQ = (source: string, row: number, column: number) =>
	writeCell(source, row, column, (raw) => raw + 'Q');

const KEYSTROKES: Array<[name: string, source: string, cell: [number, number], after: string]> = [
	['a tight body row', '|a|b|\n|-|-|\n|1|2|\n', [1, 0], '|a|b|\n|-|-|\n|1Q|2|\n'],
	['a tight header row', '|a|b|\n|-|-|\n|1|2|\n', [0, 1], '|a|bQ|\n|-|-|\n|1|2|\n'],
	[
		'an over-padded row',
		'|  a  |  b  |\n|:---|---:|\n|  1  |  2  |\n',
		[1, 1],
		'|  a  |  b  |\n|:---|---:|\n|  1  |  2Q  |\n'
	],
	['an unended table', '| a |\n| :-- |\n| 1 |', [1, 0], '| a |\n| :-- |\n| 1Q |'],
	[
		'a cell after an escaped pipe',
		'| a \\| b | c |\n|-|-|\n| 1 | 2 |\n',
		[0, 1],
		'| a \\| b | cQ |\n|-|-|\n| 1 | 2 |\n'
	],
	['a row with no leading pipe', 'a | b\n--|--\n1 | 2\n', [1, 1], 'a | b\n--|--\n1 | 2Q\n'],
	[
		'a row with no trailing pipe',
		'| a | b\n| - | -\n| 1 | 2\n',
		[1, 1],
		'| a | b\n| - | -\n| 1 | 2Q\n'
	],
	['a short row', '| a | b |\n| - | - |\n| c |\n', [1, 0], '| a | b |\n| - | - |\n| cQ |\n'],
	[
		'the missing cell of a short row',
		'| a | b |\n| - | - |\n| c |\n',
		[1, 1],
		'| a | b |\n| - | - |\n| c | Q |\n'
	],
	[
		'a row with a surplus cell',
		'| a |\n| - |\n|1| extra |\n',
		[1, 0],
		'| a |\n| - |\n|1Q| extra |\n'
	],
	['a CRLF table', '|a|b|\r\n|-|-|\r\n|1|2|\r\n', [1, 1], '|a|b|\r\n|-|-|\r\n|1|2Q|\r\n'],
	// A first cell written bare could open another block (`# x`), so that row takes pipes.
	[
		'the first cell of a row with no leading pipe',
		'a | b\n--|--\n1 | 2\n',
		[1, 0],
		'a | b\n--|--\n| 1Q | 2 |\n'
	]
];

describe('a keystroke in a table cell', () => {
	it.each(KEYSTROKES)('%s changes that cell only', (_name, source, [row, column], after) => {
		const doc = typeQ(source, row, column);
		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});

// Miss-analysis: every keystroke row typed a letter, so no write left a backslash against a pipe
// or emptied the cell a pipe-less row starts or ends with, and the read-back had no test at all.
const READ_BACK: Array<
	[name: string, source: string, cell: [number, number], text: string, after: string]
> = [
	[
		'a backslash ending a tight last cell keeps a space before the pipe',
		'|a|b|\n|-|-|\n|1|x|\n',
		[1, 1],
		'x\\',
		'|a|b|\n|-|-|\n|1|x\\ |\n'
	],
	[
		'a backslash ending a tight inner cell keeps a space before the pipe',
		'|a|b|\n|-|-|\n|1|x|\n',
		[1, 0],
		'1\\',
		'|a|b|\n|-|-|\n|1\\ |x|\n'
	],
	[
		'an even backslash run needs no space',
		'|a|b|\n|-|-|\n|1|x|\n',
		[1, 1],
		'x\\\\',
		'|a|b|\n|-|-|\n|1|x\\\\|\n'
	],
	[
		'clearing the first cell of a row with no leading pipe',
		'a | b\n--|--\n1 | 2\n',
		[1, 0],
		'',
		'a | b\n--|--\n|  | 2 |\n'
	],
	[
		'clearing the last cell of a header with no trailing pipe',
		'a | b\n--|--\n1 | 2\n',
		[0, 1],
		'',
		'| a |  |\n--|--\n1 | 2\n'
	]
];

describe('a cell write the row’s own bytes would misread, in the editor or in GFM', () => {
	it.each(READ_BACK)('%s', (_name, source, [row, column], text, after) => {
		const doc = writeCell(source, row, column, () => text);
		expect(serialize(doc)).toBe(after);
		expect(describeConvergence(doc)).toBeNull();
	});
});

const COMMITS: Array<[name: string, source: string, ops: Op[], after: string]> = [
	[
		'a cell typed into',
		'|a|b|\n|-|-|\n|1|2|\n',
		[{ t: 'typeCell', r: 1, c: 0, n: 0 }],
		'|a|b|\n|-|-|\n|1z|2|\n'
	],
	[
		'a cell typed into on an unended last line',
		'| a |\n| :-- |\n| 1 |',
		[{ t: 'typeCell', r: 1, c: 0, n: 0 }],
		'| a |\n| :-- |\n| 1z |'
	],
	[
		'a column inserted',
		'|a|b|\n|-|-|\n',
		[{ t: 'tableInsertColumn', i: 0 }],
		// Equal delimiter cells pair from the front, so the new one lands last: the same reading.
		// It takes the spelling its alignment already has in the table.
		'|a|  |b|\n|-|-| - |\n'
	],
	[
		'a column inserted beside a short row',
		'|a|b|\n|-|-|\n|1|\n',
		[{ t: 'tableInsertColumn', i: 1 }],
		'|a|b|  |\n|-|-| - |\n|1|\n'
	],
	[
		'a column deleted',
		'|a|b|c|\n|-|:-:|-|\n|1|2|3|\n',
		[{ t: 'tableDeleteColumn', i: 1 }],
		'|a|c|\n|-|-|\n|1|3|\n'
	],
	[
		'a column moved',
		'|a|b|\n|-|:-|\n|1|2|\n',
		[{ t: 'tableReorderColumn', i: 0, dir: 1 }],
		'|b|a|\n|:-|-|\n|2|1|\n'
	],
	[
		'an alignment cycled',
		'|a|b|\n|-|-|\n|1|2|\n',
		[{ t: 'tableCycleAlignment', i: 0 }],
		'|a|b|\n|:---:|-|\n|1|2|\n'
	],
	[
		'a row moved',
		'|a|\n|-|\n|1|\n|  2  |\n',
		[{ t: 'tableReorderRow', i: 1, dir: 1 }],
		'|a|\n|-|\n|  2  |\n|1|\n'
	],
	[
		'a row inserted below an unended header-only table',
		'| h |\n|:-|',
		[{ t: 'tableInsertRow', i: 0 }],
		'| h |\n|:-|\n|  |'
	],
	[
		'an alignment cycled on an unended header-only table, then its header typed into',
		'| h1 | h2 |\n| --- | --- |',
		[
			{ t: 'tableCycleAlignment', i: 1 },
			{ t: 'typeCell', r: 0, c: 0, n: 0 }
		],
		'| h1z | h2 |\n| --- | :---: |'
	]
];

describe('a table commit', () => {
	it.each(COMMITS)('%s keeps every other byte', async (_name, source, ops, after) => {
		const h = makeHarness(source);
		for (const op of ops) await runOp(h, op);
		expect(serialize(h.deps.doc)).toBe(after);
		expect(describeConvergence(h.deps.doc)).toBeNull();
	});
});
