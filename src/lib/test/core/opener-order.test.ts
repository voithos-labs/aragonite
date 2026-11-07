import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';

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
});
