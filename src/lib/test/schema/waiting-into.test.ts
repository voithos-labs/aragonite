// `waitingInto`: the block a reading no line closes leaves waiting where another block starts.
// Miss-analysis: the splice asks which block waits past a block's end. A keystroke needs the one
// that waits where its own block starts, the block right above included, and nothing asked that.
import { describe, it, expect } from 'vitest';
import { defaultGrammarView, unfinishedReadings, waitingInto } from '#lib/schema/block-openers.js';

/** Each line as a block flush under the one before; a line led by `~` has a blank line above. */
const blocks = (...lines: string[]) =>
	lines.map((line) =>
		line.startsWith('~')
			? { raw: `${line.slice(1)}\n`, leadingTrivia: '\n' }
			: { raw: `${line}\n`, leadingTrivia: '' }
	);

const STARTED = ['[a]: /u', '    "code', '[b]: /v', 'end'];

const ROWS: [string, string[], number, number, number][] = [
	['the block right above waits alone', ['[a]: /u', 'text'], 1, 0, 0],
	['a definition with its title waits on nothing', ['[a]: /u "t"', 'text'], 1, 0, -1],
	['a title started two blocks up is still open', STARTED, 3, 0, 0],
	['and open one block up', STARTED, 2, 0, 0],
	['the topmost block that waits wins', ['[z]: /y', ...STARTED], 4, 0, 1],
	['a blank line above the block ends every wait', ['[a]: /u', '~text'], 1, 0, -1],
	[
		'a blank line between ends the wait above it',
		['[a]: /u', '    "code', '~[b]: /v', 'end'],
		3,
		0,
		2
	],
	[
		'and so does one two blocks above the block asked about',
		['[a]: /u', "~    'code", 'text', 'end'],
		3,
		0,
		-1
	],
	['a heading is a line no title runs on to', ['[a]: /u', '# h'], 1, 0, -1],
	['and stops a title that started above it', ['[a]: /u', '    "code', '# h', 'end'], 3, 0, -1],
	['no block above the floor is asked', STARTED, 3, 1, 2],
	['a block at the floor has none above it', STARTED, 3, 3, -1]
];

describe('the block left waiting where another starts', () => {
	it.each(ROWS)('%s', (_, lines, at, floor, expected) => {
		const list = blocks(...lines);
		const readings = unfinishedReadings(defaultGrammarView);

		expect(waitingInto((i) => list[i], at, floor, readings)).toBe(expected);
	});
});
