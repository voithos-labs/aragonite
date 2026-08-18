import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import { parse } from '../../../core/parser';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';

// Composed-path smoke: parse → buildLinkReferenceMap → parseInline. The per-form node
// shapes live in the scan tables; the map/resolver internals in their own suites.

function inlineWithRefs(content: string, refs: string) {
	const doc = parse(content + '\n\n' + refs);
	const map = buildLinkReferenceMap(doc.children);
	return parseInline(content, 0, content.length, map.resolve);
}

describe('reference resolution through the document map', () => {
	it('full reference resolves with url and title from the LRD', () => {
		const nodes = inlineWithRefs('Click [here][go] now', '[go]: https://example.com "Go now"');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		expect(links[0].title).toBe('Go now');
		expect(links[0].label).toBe('go');
	});

	it('lookup miss emits unresolvedReference', () => {
		const nodes = inlineWithRefs('[text][missing]', '[other]: https://example.com');
		expect(nodes.filter((n) => n.kind === 'link')).toHaveLength(0);
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].label).toBe('missing');
	});
});
