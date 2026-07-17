import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';

// GFM §4.4: an indented code block cannot interrupt a paragraph, but after any
// other block (heading, fence, break, table) it opens with no blank line — a
// paragraph absorbs a following indented line structurally, so the only rule the
// opener must honor is "no open paragraph to interrupt".

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

describe('indented code — round-trips regardless of predecessor', () => {
	for (const source of ['# T\n    x\n', '---\n    x\n', 'text\n    x\n', 'text\n\n    x\n']) {
		it(`round-trips ${JSON.stringify(source)}`, () => {
			expect(serialize(parse(source))).toBe(source);
		});
	}
});
