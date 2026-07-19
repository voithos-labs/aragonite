import { describe, it, expect } from 'vitest';
import { inlineOf } from './inline-test-helpers';

describe('parseInline — links and images', () => {
	it('simple inline link', () => {
		const nodes = inlineOf('Click [here](https://example.com) now');
		expect(nodes.length).toBe(3);
		expect(nodes[0]).toEqual({ kind: 'text', start: 0, end: 6, text: 'Click ' });
		expect(nodes[1].kind).toBe('link');
		expect(nodes[1].start).toBe(6);
		expect(nodes[1].end).toBe(33);
		expect(nodes[1].url).toBe('https://example.com');
		expect(nodes[1].children!.length).toBe(1);
		expect(nodes[1].children![0]).toEqual({ kind: 'text', start: 7, end: 11, text: 'here' });
	});

	it('link with title', () => {
		const nodes = inlineOf('[text](url "title")');
		expect(nodes[0].kind).toBe('link');
		expect(nodes[0].url).toBe('url');
		expect(nodes[0].title).toBe('title');
	});

	it('image', () => {
		const nodes = inlineOf('See ![alt text](image.png) here');
		expect(nodes[1].kind).toBe('image');
		expect(nodes[1].alt).toBe('alt text');
		expect(nodes[1].url).toBe('image.png');
	});

	describe('image inline parsing — dimensions', () => {
		it('extracts |N width from alt', () => {
			const raw = '![cat|400](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			expect(nodes).toHaveLength(1);
			const img = nodes[0];
			expect(img.kind).toBe('image');
			expect(img.alt).toBe('cat');
			expect(img.width).toBe(400);
			expect(img.height).toBeUndefined();
			expect(img.url).toBe('https://example.com/cat.png');
		});

		it('extracts |NxM width and height', () => {
			const raw = '![cat|400x300](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			const img = nodes[0];
			expect(img.alt).toBe('cat');
			expect(img.width).toBe(400);
			expect(img.height).toBe(300);
		});

		it('preserves source bytes regardless of dimension hint', () => {
			const raw = '![cat|400](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			expect(raw.slice(nodes[0].start, nodes[0].end)).toBe(raw);
		});

		it('treats invalid dimension hint as plain alt', () => {
			const raw = '![cat|0](https://example.com/cat.png)';
			const nodes = inlineOf(raw);
			expect(nodes[0].alt).toBe('cat|0');
			expect(nodes[0].width).toBeUndefined();
		});
	});

	it('link with emphasis in text', () => {
		const nodes = inlineOf('[**bold link**](url)');
		expect(nodes[0].kind).toBe('link');
		expect(nodes[0].children![0].kind).toBe('strong');
	});

	it('unmatched [ is plain text', () => {
		const nodes = inlineOf('Hello [world');
		expect(nodes).toEqual([{ kind: 'text', start: 0, end: 12, text: 'Hello [world' }]);
	});

	it('link without closing paren is plain text', () => {
		const nodes = inlineOf('[text](url');
		expect(nodes.every((n) => n.kind === 'text')).toBe(true);
	});
});

describe('parseInline — totality under deep bracket nesting', () => {
	// Totality is the pin here (the DoS guard), not tree shape: the §6.3
	// links-in-links deactivation shape is pinned in the scan suite.
	it('parses 2000-deep bracket nesting without throwing and covers all bytes', () => {
		const source = '['.repeat(2000) + 'a' + '](u)'.repeat(2000);
		const nodes = inlineOf(source);
		const reconstructed = nodes.map((n) => source.slice(n.start, n.end)).join('');
		expect(reconstructed).toBe(source);
	});
});
