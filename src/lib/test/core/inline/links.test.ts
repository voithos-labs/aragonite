import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';

function inlineOf(rawContent: string) {
	return parseInline(rawContent, 0, rawContent.length);
}

describe('parseInline — autolinks (Stage 3)', () => {
	it('angle-bracket autolink', () => {
		const nodes = inlineOf('Visit <https://example.com> now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('bare URL autolink', () => {
		const nodes = inlineOf('Visit https://example.com now');
		expect(nodes[1].kind).toBe('autolink');
		expect(nodes[1].url).toBe('https://example.com');
	});

	it('non-URL angle brackets are text', () => {
		const nodes = inlineOf('Hello <world> end');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});

	it('autolink still stops at entity boundary (regression guard for 1d44f0f)', () => {
		const raw = 'see https://example.com/?a&amp;b end';
		const nodes = parseInline(raw, 0, raw.length);
		const autolinks = nodes.filter((n) => n.kind === 'autolink');
		expect(autolinks).toHaveLength(1);
		expect(autolinks[0].url).toBe('https://example.com/?a');
	});
});
