import { describe, expect, it } from 'vitest';
import {
	codeArgument,
	parseTableSize,
	tableArgument,
	tableMarkdown
} from '$lib/plugins/slash-commands/arguments';

const DEFAULT_TABLE = '| Column | Column |\n| --- | --- |\n|  |  |\n';

describe('the table argument', () => {
	it.each([
		['3x4', { columns: 3, rows: 4 }],
		['3X4', { columns: 3, rows: 4 }],
		['3×4', { columns: 3, rows: 4 }],
		['3', null],
		['x4', null],
		['0x4', null],
		['3x1', null],
		['', null]
	])('%j reads as %j', (argument, size) => {
		expect(parseTableSize(argument)).toEqual(size);
	});

	it('the default is the insert menu’s own table, byte for byte', () => {
		expect(tableMarkdown({ columns: 2, rows: 2 })).toBe(DEFAULT_TABLE);
		expect(tableArgument(null)).toEqual({ markdown: DEFAULT_TABLE });
	});

	it('3x4 is three columns: a header and three empty rows', () => {
		expect(tableArgument('3x4')).toEqual({
			markdown:
				'| Column | Column | Column |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |\n',
			detail: '3×4'
		});
	});

	it('a malformed size inserts the default and says how to write one', () => {
		const parsed = tableArgument('3');
		expect(parsed.markdown).toBe(DEFAULT_TABLE);
		expect(parsed.detail).toMatch(/^2×2 · .*3x4/);
	});
});

describe('the code argument', () => {
	it('puts the language on the opening fence', () => {
		expect(codeArgument('js')).toEqual({ markdown: '```js\n\n```\n', detail: 'js' });
	});

	it('with none, or one holding a backtick, opens a plain fence', () => {
		expect(codeArgument(null)).toEqual({ markdown: '```\n\n```\n' });
		expect(codeArgument('').markdown).toBe('```\n\n```\n');
		expect(codeArgument('j`s')).toMatchObject({ markdown: '```\n\n```\n' });
	});
});
