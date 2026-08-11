import { describe, it, expect } from 'vitest';
import { tryCompleteTableRow } from '$lib/core/parsers/table-completion';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';

// The completer's line predicate and the bytes it answers. The boundary that matters is the
// pair of gates: the parser's own row scan is the outer bound, and the leading pipe narrows it
// to an explicit table gesture so prose carrying a pipe is not swallowed.

const claim = (line: string) => tryCompleteTableRow(line);

describe('table Enter completer — which lines it claims', () => {
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

	// The escape is the parser's business, not a second rule here: `\|` stays inside its cell,
	// so a two-cell claim is what the row scan already sees.
	it('counts an escaped pipe as cell content, not a cell boundary', () => {
		expect(claim('| a \\| x | b |')!.lines[0]).toBe('| a \\| x | b |');
		expect(claim('| a \\| x | b |')!.lines[1]).toBe('| --- | --- |');
	});
});

describe('table Enter completer — the bytes it answers', () => {
	it('preserves cell content verbatim and re-pads it canonically', () => {
		expect(claim('|a|b|')!.lines).toEqual(['| a | b |', '| --- | --- |', '|  |  |']);
		expect(claim('| **x** | `y` |')!.lines[0]).toBe('| **x** | `y` |');
	});

	it('gives the delimiter and the body row the header’s cell count', () => {
		for (const count of [2, 3, 5]) {
			const header = '|' + ' c |'.repeat(count);
			const { lines } = claim(header)!;
			expect(lines).toHaveLength(3);
			expect(lines[1]).toBe('| ' + Array(count).fill('---').join(' | ') + ' |');
			expect(lines[2]).toBe('| ' + Array(count).fill('').join(' | ') + ' |');
		}
	});

	it('seats the caret in the first body cell', () => {
		expect(claim('| a | b |')!.caret).toEqual({ path: [1, 0], offset: 0 });
	});

	// The claim is only worth anything if the bytes parse back as the table it describes —
	// the round-trip invariant, asserted on the completer's own output.
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
