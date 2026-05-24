import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { parseAllInlineContent, parseInline } from '../../core/inline';
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
		expect((firstProseInlineContent(doc)?.find((n) => n.kind === 'link') as InlineNode).url).toBe(
			'https://old.com'
		);

		const lrd = doc.children[1];
		(lrd.metadata as { url?: string }).url = 'https://new.com';
		const after = buildLinkReferenceMap(doc.children);
		expect(after.signature).not.toBe(before.signature);
		parseAllInlineContent(doc.children, after.resolve);
		expect((firstProseInlineContent(doc)?.find((n) => n.kind === 'link') as InlineNode).url).toBe(
			'https://new.com'
		);
	});

	it('signature is stable across no-op rebuilds (diagnostic property)', () => {
		// The signature equality is a useful diagnostic for change detection
		// even though the editor shell no longer uses it to gate re-parsing.
		const doc = parse('Just text.\n\n[go]: https://example.com\n');
		const m1 = buildLinkReferenceMap(doc.children);
		const m2 = buildLinkReferenceMap(doc.children);
		expect(m1.signature).toBe(m2.signature);
	});

	it('after editor mount, reference links in block inlineContent are resolved', () => {
		// Simulates the block-render path: TextEditableBlock's text-render re-parses
		// inline content locally using the resolver threaded via the linkRef context.
		// This pins the wiring shape — if the resolver is dropped from the dep chain
		// the local re-parse will produce no link nodes, even though the shell's
		// parseAllInlineContent populated them.
		const doc = parse('Click [here][go] now.\n\n[go]: https://example.com\n');
		const map = buildLinkReferenceMap(doc.children);
		parseAllInlineContent(doc.children, map.resolve);

		const para = doc.children[0];
		const content = parseInline(para.raw, 0, para.raw.length, map.resolve);
		const links = content.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});
});
