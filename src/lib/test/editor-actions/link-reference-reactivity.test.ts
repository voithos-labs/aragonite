import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { parseAllInlineContent } from '../../core/inline';
import { buildLinkReferenceMap } from '../../core/inline/link-reference-resolver';
import type { CstNode, InlineNode } from '../../core/nodes';

/**
 * Pins the resolver-driven pipeline at the helper-function level. The editor
 * shell's wiring is a thin call-through to these helpers, so asserting against
 * them is robust to Svelte runtime details — the DOM-mounted shell subscribes
 * to `edit` events and re-runs the same pipeline.
 */
describe('link-reference reactivity pipeline', () => {
	function firstProseInlineContent(doc: { children: CstNode[] }): InlineNode[] | undefined {
		return doc.children[0].inlineContent;
	}

	it('initial parse with resolver populates resolved link nodes', () => {
		const doc = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		const map = buildLinkReferenceMap(doc.children);
		parseAllInlineContent(doc.children, map.resolve);
		const inline = firstProseInlineContent(doc);
		const link = inline?.find((n) => n.kind === 'link');
		expect(link?.url).toBe('https://example.com');
	});

	it('adding an LRD and re-running the pipeline resolves previously-unresolved references', () => {
		const doc = parse('Click [here][go] now.\n');
		const before = buildLinkReferenceMap(doc.children);
		parseAllInlineContent(doc.children, before.resolve);
		expect(firstProseInlineContent(doc)?.some((n) => n.kind === 'link')).toBe(false);

		const withLrd = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		doc.children.push(withLrd.children[1]);
		const after = buildLinkReferenceMap(doc.children);
		expect(after.signature).not.toBe(before.signature);
		parseAllInlineContent(doc.children, after.resolve);
		const link = firstProseInlineContent(doc)?.find((n) => n.kind === 'link');
		expect(link?.url).toBe('https://example.com');
	});

	it('removing the LRD reverts resolved references to plain text', () => {
		const doc = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		parseAllInlineContent(doc.children, buildLinkReferenceMap(doc.children).resolve);
		expect(firstProseInlineContent(doc)?.some((n) => n.kind === 'link')).toBe(true);

		doc.children.splice(1, 1);
		parseAllInlineContent(doc.children, buildLinkReferenceMap(doc.children).resolve);
		expect(firstProseInlineContent(doc)?.some((n) => n.kind === 'link')).toBe(false);
	});

	it('changing an LRD url updates resolved references and signature', () => {
		const doc = parse('See [click][go]\n\n[go]: https://old.com\n');
		const before = buildLinkReferenceMap(doc.children);
		parseAllInlineContent(doc.children, before.resolve);
		expect(
			(firstProseInlineContent(doc)?.find((n) => n.kind === 'link') as InlineNode).url
		).toBe('https://old.com');

		const lrd = doc.children[1];
		(lrd.metadata as { url?: string }).url = 'https://new.com';
		const after = buildLinkReferenceMap(doc.children);
		expect(after.signature).not.toBe(before.signature);
		parseAllInlineContent(doc.children, after.resolve);
		expect(
			(firstProseInlineContent(doc)?.find((n) => n.kind === 'link') as InlineNode).url
		).toBe('https://new.com');
	});

	it('no-op commits (no LRD set change) produce equal signatures — short-circuit fires', () => {
		const doc = parse('Just text.\n\n[go]: https://example.com\n');
		const m1 = buildLinkReferenceMap(doc.children);
		const m2 = buildLinkReferenceMap(doc.children);
		expect(m1.signature).toBe(m2.signature);
	});
});
