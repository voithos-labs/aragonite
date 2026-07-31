import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { parseInline } from '../../../core/inline';
import { getInlineContent } from '../../../core/inline/inline-cache';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';
import type { CstNode, InlineNode } from '../../../core/nodes';

/**
 * Pinned at the helper-function level, not through a mounted shell: the shell is a thin
 * call-through to these helpers, so this stays robust to Svelte runtime details.
 */
describe('link-reference reactivity pipeline', () => {
	// The signature keys the cache, so re-resolving the same node after an LRD change
	// (identical raw, new signature) must thread the fresh map through.
	function firstProseInlineContent(doc: { children: CstNode[] }): InlineNode[] {
		const map = buildLinkReferenceMap(doc.children);
		return getInlineContent(doc.children[0], map.resolve, map.signature);
	}

	it('initial parse with resolver populates resolved link nodes', () => {
		const doc = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		const link = firstProseInlineContent(doc).find((n) => n.kind === 'link');
		expect(link?.url).toBe('https://example.com');
	});

	it('adding an LRD and re-running the pipeline resolves previously-unresolved references', () => {
		const doc = parse('Click [here][go] now.\n');
		expect(firstProseInlineContent(doc).some((n) => n.kind === 'link')).toBe(false);

		const withLrd = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		doc.children.push(withLrd.children[1]);
		const link = firstProseInlineContent(doc).find((n) => n.kind === 'link');
		expect(link?.url).toBe('https://example.com');
	});

	it('removing the LRD reverts resolved references to plain text', () => {
		const doc = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		expect(firstProseInlineContent(doc).some((n) => n.kind === 'link')).toBe(true);

		doc.children.splice(1, 1);
		expect(firstProseInlineContent(doc).some((n) => n.kind === 'link')).toBe(false);
	});

	it('changing an LRD url updates resolved references and signature', () => {
		const doc = parse('See [click][go]\n\n[go]: https://old.com\n');
		const before = buildLinkReferenceMap(doc.children);
		expect((firstProseInlineContent(doc).find((n) => n.kind === 'link') as InlineNode).url).toBe(
			'https://old.com'
		);

		const lrd = doc.children[1];
		(lrd.metadata as { url?: string }).url = 'https://new.com';
		const after = buildLinkReferenceMap(doc.children);
		expect(after.signature).not.toBe(before.signature);
		expect((firstProseInlineContent(doc).find((n) => n.kind === 'link') as InlineNode).url).toBe(
			'https://new.com'
		);
	});

	it('signature is stable across no-op rebuilds', () => {
		// The render-memo key rides the signature, so an unchanged LRD set must not
		// invalidate a reference block's render.
		const doc = parse('Just text.\n\n[go]: https://example.com\n');
		const m1 = buildLinkReferenceMap(doc.children);
		const m2 = buildLinkReferenceMap(doc.children);
		expect(m1.signature).toBe(m2.signature);
	});

	it('after editor mount, reference links in a block re-parse to resolved links', () => {
		// Mirrors TextEditableBlock's local re-parse: drop the resolver from the dep chain
		// and the re-parse silently produces no link nodes.
		const doc = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		const map = buildLinkReferenceMap(doc.children);

		const para = doc.children[0];
		const content = parseInline(para.raw, 0, para.raw.length, map.resolve);
		const links = content.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});
});
