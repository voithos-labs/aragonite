import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

describe('parseInline — backslash escapes', () => {
	it('recognizes every escapable ASCII punctuation char', () => {
		for (const ch of ESCAPABLE) {
			const raw = `\\${ch}`;
			const nodes = parseInline(raw, 0, raw.length);
			const escapes = nodes.filter((n) => n.kind === 'escape');
			expect(escapes, `escapable: \\${ch}`).toHaveLength(1);
			expect(escapes[0].start).toBe(0);
			expect(escapes[0].end).toBe(2);
		}
	});

	it('does not escape non-punctuation', () => {
		for (const raw of ['\\a', '\\1', '\\ ', '\\\t']) {
			const nodes = parseInline(raw, 0, raw.length);
			expect(
				nodes.every((n) => n.kind === 'text'),
				`should be text: ${JSON.stringify(raw)}`
			).toBe(true);
		}
	});
});

describe('parseInline — escape integration', () => {
	it('escape neutralizes emphasis delimiter', () => {
		const raw = '\\*foo\\*';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'emphasis')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(2);
	});

	it('escape inside code span is inert', () => {
		const raw = '`\\*`';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'escape')).toBe(false);
		expect(nodes.some((n) => n.kind === 'inlineCode')).toBe(true);
	});

	it('escape neutralizes strong delimiter', () => {
		const raw = '\\*\\*foo\\*\\*';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'strong')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(4);
	});

	it('escape and link in same paragraph: emphasis still neutralized', () => {
		const raw = '\\*foo\\* [link](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'emphasis')).toBe(false);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(2);
		expect(nodes.some((n) => n.kind === 'link')).toBe(true);
	});
});
