import { describe, it, expect } from 'vitest';
import type { InlineNode } from '../../../core/nodes';
import { parseInline } from '../../../core/inline';

// Structural invariant: concatenating raw.slice(n.start, n.end) for every top-level
// node reproduces raw[start, end) exactly once, with no gaps, overlaps, or duplicates.
function assertCoversExactlyOnce(
	raw: string,
	nodes: InlineNode[],
	start: number,
	end: number
): void {
	let cursor = start;
	for (const node of nodes) {
		expect(node.start, `gap or overlap before node ${JSON.stringify(node)}`).toBe(cursor);
		expect(node.end).toBeGreaterThanOrEqual(node.start);
		cursor = node.end;
	}
	expect(cursor, 'final cursor must reach end').toBe(end);
}

describe('parseInline — top-level coverage invariant', () => {
	it('link with entity in text: entity belongs to children only, not top-level', () => {
		const raw = '[&copy; me](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);

		assertCoversExactlyOnce(raw, nodes, 0, raw.length);

		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(nodes.filter((n) => n.kind === 'entityReference')).toHaveLength(0);

		const linkEntities = links[0].children?.filter((c) => c.kind === 'entityReference');
		expect(linkEntities).toHaveLength(1);
		expect(linkEntities?.[0].decoded).toBe('©');
	});

	it('link with entity in text: no phantom autolink for destination bytes', () => {
		const raw = '[text with &amp;](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);

		assertCoversExactlyOnce(raw, nodes, 0, raw.length);
		expect(nodes.filter((n) => n.kind === 'autolink')).toHaveLength(0);

		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('link with escape in text: escape belongs to children only', () => {
		const raw = '[a \\*b](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);

		assertCoversExactlyOnce(raw, nodes, 0, raw.length);
		expect(nodes.filter((n) => n.kind === 'escape')).toHaveLength(0);

		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		const linkEscapes = links[0].children?.filter((c) => c.kind === 'escape');
		expect(linkEscapes).toHaveLength(1);
	});

	it('link with code span in text: code span belongs to children only', () => {
		const raw = '[see `x`](https://example.com)';
		const nodes = parseInline(raw, 0, raw.length);

		assertCoversExactlyOnce(raw, nodes, 0, raw.length);
		expect(nodes.filter((n) => n.kind === 'inlineCode')).toHaveLength(0);

		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		const linkCode = links[0].children?.filter((c) => c.kind === 'inlineCode');
		expect(linkCode).toHaveLength(1);
	});

	it('image with entity in alt: entity belongs to image alt parsing, not top-level', () => {
		const raw = '![&copy; logo](logo.png)';
		const nodes = parseInline(raw, 0, raw.length);

		assertCoversExactlyOnce(raw, nodes, 0, raw.length);
		expect(nodes.filter((n) => n.kind === 'entityReference')).toHaveLength(0);
		expect(nodes.filter((n) => n.kind === 'image')).toHaveLength(1);
	});

	it('text adjacent to link with nested entity: surrounding text segments stay intact', () => {
		const raw = 'pre [&copy; me](https://example.com) post';
		const nodes = parseInline(raw, 0, raw.length);

		assertCoversExactlyOnce(raw, nodes, 0, raw.length);

		const text = nodes.filter((n) => n.kind === 'text');
		expect(text.map((t) => t.text).join('|')).toBe('pre | post');
	});
});
