import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { unwrapFirstChildFromQuote } from '../../tree-operations';
import type { CstNode } from '../../core/nodes';

// Lifting the first child out of a quote-shaped container. Blockquote coverage lives
// here (single- vs multi-paragraph, nested quotes/lists, input immutability); the
// GitHub-alert branch — whose marker drops so the remainder is a plain blockquote —
// is pinned against a real parsed alert in `plugins/admonitions/github-alert-unwrap`.

describe('unwrapFirstChildFromQuote', () => {
	function parseBlockquote(src: string): CstNode {
		const doc = parse(src);
		const bq = doc.children[0];
		if (bq?.kind !== 'blockquote') {
			throw new Error(`expected blockquote, got ${bq?.kind}`);
		}
		return bq;
	}

	it('single-paragraph blockquote returns just the lifted paragraph', () => {
		const bq = parseBlockquote('> Hello world\n');
		const snapshot = JSON.stringify(bq);

		const result = unwrapFirstChildFromQuote(bq);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('Hello world');
		expect(JSON.stringify(bq)).toBe(snapshot);
	});

	it('multi-paragraph blockquote returns lifted paragraph + shrunk blockquote', () => {
		const bq = parseBlockquote('> First\n>\n> Second\n');

		const result = unwrapFirstChildFromQuote(bq);

		expect(result).toHaveLength(2);
		expect(result[0].kind).toBe('paragraph');
		expect((result[0].raw ?? '').trim()).toBe('First');
		expect(result[1].kind).toBe('blockquote');
		const remainingRaw = result[1].raw ?? '';
		expect(remainingRaw).toMatch(/^> /m);
		expect(remainingRaw).toContain('Second');
		expect(remainingRaw).not.toContain('First');
	});

	it('blockquote whose first child is itself a blockquote lifts the inner blockquote', () => {
		const bq = parseBlockquote('> > Deep\n');

		const result = unwrapFirstChildFromQuote(bq);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('blockquote');
		expect(result[0].raw ?? '').toContain('Deep');
	});

	it('blockquote whose first child is a list lifts the list', () => {
		const bq = parseBlockquote('> - Item\n');

		const result = unwrapFirstChildFromQuote(bq);

		expect(result).toHaveLength(1);
		expect(result[0].kind).toBe('list');
	});

	it('input container is not mutated', () => {
		const bq = parseBlockquote('> First\n>\n> Second\n');
		const before = serialize({ children: [bq], prefix: '', suffix: '' });

		unwrapFirstChildFromQuote(bq);

		expect(serialize({ children: [bq], prefix: '', suffix: '' })).toBe(before);
	});
});
