import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';

const kindOf = (src: string, i = 0) => parse(src).children[i].kind;

describe('opener dispatch order (registry encodes the legacy chain)', () => {
	it('thematic break beats list for "- - -"', () => {
		expect(kindOf('- - -\n')).toBe('thematicBreak');
	});

	it('setext underline beats thematic break after an open paragraph', () => {
		const doc = parse('title\n---\n');
		expect(doc.children[0].kind).toBe('setextHeading');
	});

	it('fence beats everything at dispatch', () => {
		expect(kindOf('```\n# not a heading\n```\n')).toBe('fencedCode');
	});

	it('indented code cannot interrupt a paragraph (absorbed as continuation)', () => {
		const doc = parse('para\n    code?\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.children[0].kind).toBe('paragraph');
	});

	it('indented code opens after a blank line and at window start', () => {
		expect(kindOf('para\n\n    code\n', 1)).toBe('indentedCode');
		expect(kindOf('    code\n')).toBe('indentedCode');
	});

	it('html block types 1-6 interrupt a paragraph; list bullet interrupts', () => {
		expect(parse('para\n<div>\n').children.map((c) => c.kind)).toEqual(['paragraph', 'htmlBlock']);
		expect(parse('para\n- item\n').children.map((c) => c.kind)).toEqual(['paragraph', 'list']);
	});
});
