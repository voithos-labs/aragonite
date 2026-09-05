import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { describeRoundTrips } from '$lib/test/support/round-trip';

// GFM §4.4: a paragraph absorbs a following indented line structurally, so the only rule
// the opener must honor is "no open paragraph to interrupt" — no blank line is required.

describe('indented code — opening after a non-paragraph predecessor (GFM §4.4)', () => {
	it('opens directly after a heading, with no blank line', () => {
		expect(parse('# T\n    x\n').children.map((n) => n.kind)).toEqual(['heading', 'indentedCode']);
	});

	const nonParagraphPredecessors: { name: string; source: string }[] = [
		{ name: 'fenced code', source: '```\ncode\n```\n    x\n' },
		{ name: 'thematic break', source: '---\n    x\n' },
		{ name: 'ATX heading', source: '## h\n    x\n' }
	];
	for (const { name, source } of nonParagraphPredecessors) {
		it(`opens directly after a ${name}`, () => {
			expect(parse(source).children.at(-1)!.kind).toBe('indentedCode');
		});
	}

	it('opens at document start (first block in the window)', () => {
		expect(parse('    x\n').children.map((n) => n.kind)).toEqual(['indentedCode']);
	});
});

describe('indented code — never interrupts an open paragraph', () => {
	it('an indented line after paragraph text is lazy continuation, not code', () => {
		expect(parse('text\n    x\n').children.map((n) => n.kind)).toEqual(['paragraph']);
	});

	it('opens after a blank line closes the paragraph', () => {
		expect(parse('text\n\n    x\n').children.map((n) => n.kind)).toEqual([
			'paragraph',
			'indentedCode'
		]);
	});
});

// Miss-analysis (C-M5): every fixture indented with literal spaces or a leading tab, so the
// matcher's missing tab-column expansion — the one thematic-break.ts already carries — had no
// case. Expected shapes verified against cmark-gfm via api.github.com/markdown.
describe('indented code — a tab advances to the next 4-column stop (GFM §2.2)', () => {
	const indents: { name: string; prefix: string; code: boolean }[] = [
		{ name: 'two spaces then a tab', prefix: '  \t', code: true },
		{ name: 'three spaces then a tab', prefix: '   \t', code: true },
		{ name: 'one space then a tab', prefix: ' \t', code: true },
		{ name: 'three spaces alone', prefix: '   ', code: false }
	];

	for (const { name, prefix, code } of indents) {
		it(`reads ${name} as ${code ? 'code' : 'a paragraph'}`, () => {
			const source = `${prefix}foo\n`;
			expect(parse(source).children.map((n) => n.kind)).toEqual([
				code ? 'indentedCode' : 'paragraph'
			]);
			expect(serialize(parse(source))).toBe(source);
		});
	}
});

describeRoundTrips('indented code — round-trips regardless of predecessor', [
	'# T\n    x\n',
	'---\n    x\n',
	'text\n    x\n',
	'text\n\n    x\n'
]);
