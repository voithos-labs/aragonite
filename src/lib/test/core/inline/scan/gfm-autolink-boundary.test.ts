// Miss-analysis: no boundary case put a url right after an inline construct.
import { describe, expect, it } from 'vitest';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { scanInline } from '#lib/core/inline/scan/index.js';
import {
	autolinkNode,
	codeNode,
	describeScanCases,
	emphasisNode,
	entityNode,
	hardBreak,
	textNode
} from './scan-test-helpers';

// GFM §6.9: an extended autolink comes at the start of the line, after whitespace, or after
// `*`, `_`, `~` or `(`. The source character before the url decides, whatever node holds it.
describeScanCases('a claimed construct right before a url is no boundary', [
	[
		'after an angle autolink',
		'<http://a.com>www.b.com',
		[autolinkNode(0, 14, 'http://a.com'), textNode(14, 23, 'www.b.com')]
	],
	['after a code span', '`c`http://a.b', [codeNode(0, 3, 'c'), textNode(3, 13, 'http://a.b')]],
	['after an entity', '&amp;www.a.com', [entityNode(0, 5, '&'), textNode(5, 14, 'www.a.com')]],
	[
		'an email after an angle autolink',
		'<http://a.com>x@y.co',
		[autolinkNode(0, 14, 'http://a.com'), textNode(14, 20, 'x@y.co')]
	]
]);

describeScanCases('the boundaries GFM allows still link', [
	['at the start of the text', 'www.a.com', [autolinkNode(0, 9, 'http://www.a.com')]],
	[
		'wrapped in emphasis',
		'*www.a.com*',
		[emphasisNode(0, 11, [autolinkNode(1, 10, 'http://www.a.com')])]
	],
	[
		'in parentheses',
		'(www.a.com)',
		[textNode(0, 1, '('), autolinkNode(1, 10, 'http://www.a.com'), textNode(10, 11, ')')]
	],
	[
		'after whitespace that follows a claimed construct',
		'&amp; www.a.com',
		[entityNode(0, 5, '&'), textNode(5, 6, ' '), autolinkNode(6, 15, 'http://www.a.com')]
	],
	[
		'at the start of a line after a hard break',
		'x\\\nwww.a.com',
		[textNode(0, 1, 'x'), hardBreak(1, 3), autolinkNode(3, 12, 'http://www.a.com')]
	]
]);

describe('the scan range start', () => {
	it('counts as the start of the line, whatever byte precedes it in the block', () => {
		const raw = '> www.a.com';
		expect(scanInline(raw, 2, raw.length, undefined, defaultGrammarView)).toEqual([
			autolinkNode(2, 11, 'http://www.a.com')
		]);
	});
});
