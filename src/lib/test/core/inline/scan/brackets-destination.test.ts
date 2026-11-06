import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../../core/nodes';
import {
	assertConstructCoverage,
	assertTotalCoverage,
	collectKind,
	linkNode,
	textNode,
	parsed
} from './scan-test-helpers';

// Destination/title grammar plus the spec url/title processing chain. Every expected
// url/title was read from commonmark.js's AST, the conformance reference.

/** The whole input parses as exactly one bracket node spanning it; returns the node. */
function scanWholeInputBracket(input: string): InlineNode {
	const nodes = parsed(input, 0, input.length);
	assertTotalCoverage(nodes, 0, input.length);
	assertConstructCoverage(nodes);
	const found = [...collectKind(nodes, 'link'), ...collectKind(nodes, 'image')];
	expect(found).toHaveLength(1);
	expect(found[0].kind).toBe('link');
	expect([found[0].start, found[0].end]).toEqual([0, input.length]);
	return found[0];
}

function describeUrlCases(
	family: string,
	cases: Array<[name: string, input: string, url: string, title?: string]>
): void {
	describe(family, () => {
		for (const [name, input, url, title] of cases) {
			it(name, () => {
				const node = scanWholeInputBracket(input);
				expect(node.url).toBe(url);
				expect(node.title).toBe(title);
			});
		}
	});
}

describeUrlCases('destination forms', [
	['angle: space in destination', '[a](<b c>)', 'b%20c'],
	['empty destination', '[a]()', ''],
	['whitespace-only tail', '[a]( )', ''],
	['newline before destination is separator whitespace', '[a](\nb)', 'b'],
	['newline after destination is separator whitespace', '[a](b\n)', 'b'],
	['spaces around an angle destination', '[a](   <b>  )', 'b']
]);

describeUrlCases('destination terminators are ASCII whitespace only', [
	[
		'nbsp is destination content (baseline link-nbsp-whitespace)',
		'[link](/url\u00A0"title")',
		'/url%C2%A0%22title%22'
	],
	['control char is destination content', '[a](b\u0001c)', 'b%01c'],
	['DEL is destination content', '[a](b\u007F)', 'b%7F']
]);

describeUrlCases('titles', [
	['paren title with escaped close', '[a](b (t\\)t))', 'b', 't)t'],
	['single-quoted title with a double quote inside', "[a](b 't\"i')", 'b', 't"i'],
	['quote abutting destination is content, not a title', '[a](b"t")', 'b%22t%22'],
	['bare destination that is only a quoted string', '[link]("title")', '%22title%22']
]);

describeUrlCases('url processing chain', [
	['backtick encodes', '[](`)', '%60'],
	['open bracket encodes', '[]([)', '%5B'],
	['malformed percent gets encoded', '[a](%2)', '%252'],
	['named entity decodes to non-ascii then encodes', '[a](&copy;)', '%C2%A9'],
	['numeric entity decodes to a kept ascii char', '[a](&#35;)', '#'],
	['astral destination utf-8 percent-encodes', '[a](𐄀)', '%F0%90%84%80']
]);

describe('title placement', () => {
	it('quote-split sweep exemplar: quote starts the destination', () => {
		const raw = "[中 ]('b)_𐄀`&b";
		const nodes = parsed(raw, 0, raw.length);
		assertTotalCoverage(nodes, 0, raw.length);
		expect(collectKind(nodes, 'link')).toEqual([linkNode(0, 8, [textNode(1, 3, '中 ')], "'b")]);
	});
});

describe('invalid destination or title forms fall back to literal', () => {
	const literalInputs: Array<[name: string, input: string]> = [
		['unbalanced paren exemplar', '[](()'],
		['escaped close paren is content, tail never closes', '[](\\)'],
		['unterminated title', '[a](b "unterminated)'],
		['two titles', '[a](b "t1" "t2")'],
		['tab cannot separate destination and title', '[a](b\t"t")'],
		['tab before destination', '[a](\tb)'],
		['no whitespace between angle destination and title', '[a](<b>"t")'],
		['sweep newline exemplar', "[0](𐄀*\n(é𐄀])é!b'"]
	];
	for (const [name, input] of literalInputs) {
		it(name, () => {
			const nodes = parsed(input, 0, input.length);
			assertTotalCoverage(nodes, 0, input.length);
			expect(collectKind(nodes, 'link')).toEqual([]);
			expect(collectKind(nodes, 'image')).toEqual([]);
		});
	}
});
