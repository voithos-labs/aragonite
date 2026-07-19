import { describe, it, expect } from 'vitest';
import { scanInline } from '../../../../core/inline/scan';
import {
	assertTotalCoverage,
	describeScanCases,
	codeNode,
	entityNode,
	escapeNode,
	hardBreak,
	textNode
} from './scan-test-helpers';

describeScanCases('plain text', [
	['prose passes through as one text node', 'hello world', [textNode(0, 11, 'hello world')]],
	[
		'common punctuation takes the fast bail',
		'Hello, world! (ok?)',
		[textNode(0, 19, 'Hello, world! (ok?)')]
	],
	['astral code points keep UTF-16 offsets', '😀 ok', [textNode(0, 5, '😀 ok')]]
]);

describeScanCases('escapes', [
	['escape covers backslash + punctuation', '\\*a', [escapeNode(0), textNode(2, 3, 'a')]],
	['escaped backtick does not open a code span', '\\`x', [escapeNode(0), textNode(2, 3, 'x')]],
	['double backslash escapes itself', '\\\\*', [escapeNode(0), textNode(2, 3, '*')]],
	['escaped ampersand suppresses the entity', '\\&copy;', [escapeNode(0), textNode(2, 7, 'copy;')]],
	['backslash before non-punctuation stays text', '\\a', [textNode(0, 2, '\\a')]],
	['backslash before non-ASCII punctuation stays text', '\\é', [textNode(0, 2, '\\é')]],
	['trailing backslash stays text', 'foo\\', [textNode(0, 4, 'foo\\')]]
]);

describeScanCases('hard line breaks', [
	['backslash form', 'a\\\nb', [textNode(0, 1, 'a'), hardBreak(1, 3), textNode(3, 4, 'b')]],
	[
		'backslash form over CRLF',
		'a\\\r\nb',
		[textNode(0, 1, 'a'), hardBreak(1, 4), textNode(4, 5, 'b')]
	],
	['two trailing spaces', 'a  \nb', [textNode(0, 1, 'a'), hardBreak(1, 4), textNode(4, 5, 'b')]],
	[
		'three trailing spaces all belong to the break',
		'a   \nb',
		[textNode(0, 1, 'a'), hardBreak(1, 5), textNode(5, 6, 'b')]
	],
	[
		'two trailing spaces over CRLF',
		'a  \r\nb',
		[textNode(0, 1, 'a'), hardBreak(1, 5), textNode(5, 6, 'b')]
	],
	['one trailing space is a softbreak: plain text', 'a \nb', [textNode(0, 4, 'a \nb')]],
	['break at range start', '  \nb', [hardBreak(0, 3), textNode(3, 4, 'b')]],
	['space lookback stops at a consumed node', '`x`  \n', [codeNode(0, 3, 'x'), hardBreak(3, 6)]],
	['backslash + one space is not a break', 'a\\ \nb', [textNode(0, 5, 'a\\ \nb')]],
	['lone \\r is not a line ending', 'a  \rb', [textNode(0, 5, 'a  \rb')]]
]);

describeScanCases('entities', [
	['named entity carries decoded', '&copy;', [entityNode(0, 6, '©')]],
	['decimal numeric reference', '&#35;', [entityNode(0, 5, '#')]],
	['hex astral reference', '&#x1F600;', [entityNode(0, 9, '😀')]],
	['NUL decodes to U+FFFD', '&#0;', [entityNode(0, 4, '�')]],
	['unknown name stays text', '&notanentity', [textNode(0, 12, '&notanentity')]],
	['empty reference stays text', '&;', [textNode(0, 2, '&;')]],
	[
		'entity between text runs',
		'a&amp;b',
		[textNode(0, 1, 'a'), entityNode(1, 6, '&'), textNode(6, 7, 'b')]
	],
	[
		'failed candidate does not mask a later entity',
		'&am&amp;',
		[textNode(0, 3, '&am'), entityNode(3, 8, '&')]
	]
]);

describeScanCases('unclaimed specials', [
	[
		'bracket and angle characters fall through as text',
		'[d] !e < f',
		[textNode(0, 10, '[d] !e < f')]
	]
]);

describe('ranges', () => {
	it('empty range yields no nodes', () => {
		const nodes = scanInline('abc', 1, 1);
		assertTotalCoverage(nodes, 1, 1);
		expect(nodes).toEqual([]);
	});

	it('offsets stay absolute into raw on a sub-range', () => {
		const nodes = scanInline('x&copy;y', 1, 8);
		assertTotalCoverage(nodes, 1, 8);
		expect(nodes).toEqual([entityNode(1, 7, '©'), textNode(7, 8, 'y')]);
	});
});
