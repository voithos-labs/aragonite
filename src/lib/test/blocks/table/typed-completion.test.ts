import { describe, it, expect } from 'vitest';
import { tryCompleteTableRow } from '#lib/core/parsers/table-completion.js';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';

// Which lines the table's Enter completer claims: the parser's row scan, narrowed by a leading
// pipe so prose carrying a pipe is left alone. `table-row-writers.test.ts` pins the bytes.

const claim = (line: string) => tryCompleteTableRow(line);

describe('table Enter completer: which lines it claims', () => {
	it.each([
		['| a | b |', 'both edge pipes'],
		['| a | b', 'no trailing pipe'],
		['|a|b|', 'no padding'],
		['   | a | b |  ', 'surrounding whitespace'],
		['|  |  |', 'empty cells'],
		['| a \\| x | b |', 'an escaped pipe inside a cell']
	])('claims %j (%s)', (line) => {
		expect(claim(line)).not.toBeNull();
	});

	it.each([
		['|a|', 'one cell — the scan would not accept it as a two-column header'],
		['| a |', 'one cell, padded'],
		['a | b', 'no leading pipe — prose, which the scan alone would take'],
		['Use ls | grep foo to filter', 'a pipe inside ordinary prose'],
		['plain prose', 'no pipe at all'],
		['', 'an empty line']
	])('declines %j (%s)', (line) => {
		expect(claim(line)).toBeNull();
	});
});

describe('table Enter completer: the answer it gives', () => {
	it('puts the caret in the first body cell', () => {
		expect(claim('| a | b |')!.caret).toEqual({ path: [1, 0], line: 0, column: 0 });
	});

	// The answer is worth something only if its bytes parse back as the table it describes.
	it('answers bytes that parse to one table and serialize back unchanged', () => {
		const source = claim('| a | b |')!
			.lines.map((l) => l + '\n')
			.join('');
		const doc = parse(source);
		expect(doc.children.map((c) => c.kind)).toEqual(['table']);
		expect(doc.children[0].children).toHaveLength(2);
		expect(doc.children[0].children![1].children!.map((c) => c.raw)).toEqual(['', '']);
		expect(serialize(doc)).toBe(source);
	});
});
