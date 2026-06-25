import { describe, it, expect } from 'vitest';
import { parseInline } from '../../../core/inline';
import { parse } from '../../../core/parser';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';

function inlineWithRefs(content: string, refs: string) {
	const doc = parse(content + '\n\n' + refs);
	const map = buildLinkReferenceMap(doc.children);
	return parseInline(content, 0, content.length, map.resolve);
}

describe('reference-style link resolution (CommonMark §6.3)', () => {
	it('full reference: [text][label] resolves with url', () => {
		const nodes = inlineWithRefs('Click [here][go] now', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		expect(links[0].label).toBe('go');
	});

	it('full reference: title from LRD is propagated', () => {
		const nodes = inlineWithRefs('[here][go]', '[go]: https://example.com "Go now"');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links[0].title).toBe('Go now');
	});

	it('full reference: backslash-escaped bracket in the label resolves (CommonMark §4.7)', () => {
		// The LRD parser is escape-aware; the inline scanner must match it.
		const nodes = inlineWithRefs('[text][a\\]b]', '[a\\]b]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('full reference: text portion is parsed as inline children', () => {
		const nodes = inlineWithRefs('[**bold** text][go]', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links[0].children?.some((c) => c.kind === 'strong')).toBe(true);
	});

	it('collapsed reference: [label][] resolves using text as label', () => {
		const nodes = inlineWithRefs('See [foo][] today', '[foo]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		expect(links[0].label).toBe('foo');
	});

	it('shortcut reference: [label] resolves using text as label', () => {
		const nodes = inlineWithRefs('See [foo] today', '[foo]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('case-insensitive label match', () => {
		const nodes = inlineWithRefs('[Click][GO]', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('whitespace-collapsing label match', () => {
		const nodes = inlineWithRefs('[Click][my  label]', '[my label]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
	});

	it('unresolved reference falls through to plain text (no link)', () => {
		const nodes = inlineWithRefs('[click][missing]', '[other]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(0);
	});

	it('inline form takes precedence over reference', () => {
		const nodes = inlineWithRefs('[click](https://other.com)', '[click]: https://ref.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://other.com');
	});

	it('reference brackets inside code spans do not resolve', () => {
		const nodes = inlineWithRefs('See `[click][go]` here', '[go]: https://example.com');
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(0);
	});

	it('no resolver passed: reference falls through (existing behavior preserved)', () => {
		const nodes = parseInline('[click][go]', 0, '[click][go]'.length);
		expect(nodes.every((n) => n.kind !== 'link')).toBe(true);
	});
});

describe('reference-style image resolution (CommonMark §6.3)', () => {
	it('full reference image: ![alt][label] resolves', () => {
		const nodes = inlineWithRefs('See ![pic][img] here', '[img]: /img.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/img.png');
		expect(images[0].alt).toBe('pic');
		expect(images[0].label).toBe('img');
	});

	it('collapsed reference image: ![alt][] resolves using alt as label', () => {
		const nodes = inlineWithRefs('![logo][]', '[logo]: /logo.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/logo.png');
		expect(images[0].alt).toBe('logo');
	});

	it('shortcut reference image: ![label] resolves', () => {
		const nodes = inlineWithRefs('![logo]', '[logo]: /logo.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/logo.png');
	});

	it('reference image with title from LRD', () => {
		const nodes = inlineWithRefs('![alt][img]', '[img]: /pic.png "Title"');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images[0].title).toBe('Title');
	});

	it('image dimension hint in alt text is parsed', () => {
		// `|100x50` dimension hint — the alt text is "logo|100x50" before
		// dimension-hint parsing strips the suffix
		const nodes = inlineWithRefs('![logo|100x50][img]', '[img]: /pic.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].alt).toBe('logo');
		expect(images[0].width).toBe(100);
		expect(images[0].height).toBe(50);
	});

	it('unresolved reference image falls through to plain text', () => {
		const nodes = inlineWithRefs('![alt][missing]', '[other]: /img.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(0);
	});

	it('inline image form takes precedence over reference', () => {
		const nodes = inlineWithRefs('![alt](/inline.png)', '[alt]: /ref.png');
		const images = nodes.filter((n) => n.kind === 'image');
		expect(images).toHaveLength(1);
		expect(images[0].url).toBe('/inline.png');
	});

	it('image inside reference link: [![alt][img]][link] both resolve', () => {
		const source = '[![pic][img]][link]';
		const refs = '[img]: /pic.png\n[link]: https://example.com';
		const nodes = inlineWithRefs(source, refs);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('https://example.com');
		const innerImages = links[0].children?.filter((c) => c.kind === 'image');
		expect(innerImages).toHaveLength(1);
		expect(innerImages?.[0].url).toBe('/pic.png');
	});
});

describe('unresolvedReference emission (CommonMark §6.3 deviation)', () => {
	it('full reference link with no matching LRD emits unresolvedReference (refKind=link)', () => {
		const nodes = inlineWithRefs('[text][missing]', '[other]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('link');
		expect(unresolved[0].label).toBe('missing');
	});

	it('collapsed reference link with no matching LRD emits unresolvedReference', () => {
		const nodes = inlineWithRefs('[missing][]', '[other]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('link');
	});

	it('shortcut reference with no match still falls through to text (ambiguity)', () => {
		const nodes = inlineWithRefs('[just text]', '[other]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(0);
	});

	it('full reference image with no matching LRD emits unresolvedReference (refKind=image)', () => {
		const nodes = inlineWithRefs('![alt][missing]', '[other]: /img.png');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('image');
	});

	it('collapsed reference image with no matching LRD emits unresolvedReference', () => {
		const nodes = inlineWithRefs('![missing][]', '[other]: /img.png');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(1);
		expect(unresolved[0].refKind).toBe('image');
	});

	it('resolved references do NOT emit unresolvedReference', () => {
		const nodes = inlineWithRefs('[text][foo]', '[foo]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(0);
		expect(nodes.filter((n) => n.kind === 'link')).toHaveLength(1);
	});

	it('shortcut reference WITH match still resolves normally', () => {
		const nodes = inlineWithRefs('[foo]', '[foo]: https://example.com');
		const unresolved = nodes.filter((n) => n.kind === 'unresolvedReference');
		expect(unresolved).toHaveLength(0);
		expect(nodes.filter((n) => n.kind === 'link')).toHaveLength(1);
	});
});
