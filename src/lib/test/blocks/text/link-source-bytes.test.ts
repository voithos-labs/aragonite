// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { parseInline } from '$lib/core/inline';
import { buildLinkReferenceMap } from '$lib/core/inline/link-reference-resolver';
import type { LinkReferenceResolver } from '$lib/core/inline/link-reference-resolver';
import type { InlineNode } from '$lib/core/nodes';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import {
	buildLinkEditBytes,
	buildLinkUnwrapBytes,
	linkFieldsFromInline
} from '$lib/components/blocks/text/link-source-bytes';

// Every case states the DISPLAY bytes the seam is offered, because the seam verifies its candidate
// against what the render path paints for them — a decline is as pinned as a rewrite.

const REFS = '[ref]: https://example.com/a';

function resolverFor(display: string): LinkReferenceResolver {
	return buildLinkReferenceMap(parse(`${display}\n\n${REFS}\n`).children).resolve;
}

function flatten(nodes: InlineNode[]): InlineNode[] {
	return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}

function firstLink(display: string, resolver?: LinkReferenceResolver): InlineNode {
	const link = flatten(parseInline(display, 0, display.length, resolver)).find(
		(n) => n.kind === 'link' || n.kind === 'autolink'
	);
	if (!link) throw new Error(`no link parsed from ${JSON.stringify(display)}`);
	return link;
}

function editUrl(display: string, url: string): string | null {
	const link = firstLink(display);
	return buildLinkEditBytes(link, display, { ...linkFieldsFromInline(link, display), url });
}

describe('link edit bytes — the destination the reader never saw', () => {
	it('rewrites an inline destination and keeps the text bytes verbatim', () => {
		expect(editUrl('[**bold** t](old)', 'new')).toBe('[**bold** t](new)');
	});

	it('keeps a title the edit did not touch', () => {
		expect(editUrl('[t](old "Ti")', 'new')).toBe('[t](new "Ti")');
	});

	it('escapes a quote the title gained', () => {
		const display = '[t](u "Ti")';
		const link = firstLink(display);
		const fields = { ...linkFieldsFromInline(link, display), title: 'a "q" b' };
		expect(buildLinkEditBytes(link, display, fields)).toBe('[t](u "a \\"q\\" b")');
	});

	it('an empty-text link keeps its empty brackets', () => {
		expect(editUrl('[](old)', 'new')).toBe('[](new)');
	});
});

describe('link edit bytes — adversarial destinations', () => {
	// The inline arbitrary's destination alphabet (test/invariants/arbitraries/inline.ts): each byte
	// closes the construct early, or reopens it, if the encoder lets it through raw.
	const HOSTILE = ['u`)', 'a(b)c', 'u\\)', '<u v>', 'u v', 'u"q'];

	it.each(HOSTILE)('destination %j still parses back as ONE link spanning the bytes', (url) => {
		const bytes = editUrl('[t](old)', url);
		expect(bytes).not.toBeNull();
		const rebuilt = firstLink(bytes!);
		expect(rebuilt.kind).toBe('link');
		expect(rebuilt.start).toBe(0);
		expect(rebuilt.end).toBe(bytes!.length);
	});

	it('every destination stop character percent-encodes', () => {
		expect(editUrl('[t](old)', 'a(b)c')).toBe('[t](a%28b%29c)');
		expect(editUrl('[t](old)', 'u v')).toBe('[t](u%20v)');
		expect(editUrl('[t](old)', 'u"q')).toBe('[t](u%22q)');
		expect(editUrl('[t](old)', 'u\\)')).toBe('[t](u%5C%29)');
	});

	// Miss: the hostile alphabet carried no line breaks, so a multi-line paste built bytes the
	// verifier refused and the whole edit died silently instead of encoding.
	it('encodes line breaks, which otherwise break the construct and decline the edit', () => {
		expect(editUrl('[t](old)', 'a\nb')).toBe('[t](a%0Ab)');
		expect(editUrl('[t](old)', 'a\r\nb')).toBe('[t](a%0D%0Ab)');
	});

	it('an already-encoded destination is idempotent', () => {
		expect(editUrl('[t](old)', 'u%60%29')).toBe('[t](u%60%29)');
	});
});

describe('link edit bytes — reference forms', () => {
	it.each(['[t][ref]', '[ref][]', '[ref]'])('%s round-trips byte-for-byte', (display) => {
		const resolver = resolverFor(display);
		const link = firstLink(display, resolver);
		const fields = linkFieldsFromInline(link, display);
		expect(buildLinkEditBytes(link, display, fields, resolver)).toBe(display);
	});

	it('inlines the destination when the caller drops the reference tail', () => {
		const display = '[t][ref]';
		const resolver = resolverFor(display);
		const link = firstLink(display, resolver);
		const { text } = linkFieldsFromInline(link, display);
		expect(buildLinkEditBytes(link, display, { text, url: 'new' }, resolver)).toBe('[t](new)');
	});
});

describe('link edit bytes — the seam declines rather than destroy bytes', () => {
	it('declines a link an inline rung claimed: no rewriteLink hook exists', () => {
		const link = { ...firstLink('[t](old)'), syntaxClaim: { prefix: '[[' } };
		expect(buildLinkEditBytes(link, '[t](old)', { text: 't', url: 'new' })).toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['link-edit']);
	});

	it('declines a candidate that would change what the reader sees', () => {
		// Text bytes closing the construct early: the tail would paint as literal source.
		const link = firstLink('[t](old)');
		expect(buildLinkEditBytes(link, '[t](old)', { text: 't](x) leak [', url: 'new' })).toBeNull();
	});
});

describe('link unwrap bytes — remove link', () => {
	it('an inline link unwraps to its text bytes, nested constructs intact', () => {
		expect(buildLinkUnwrapBytes(firstLink('a [**b** c](u) d'), 'a [**b** c](u) d')).toBe('**b** c');
	});

	it('a reference link unwraps to its text and leaves the definition alone', () => {
		const resolver = resolverFor('[t][ref]');
		expect(buildLinkUnwrapBytes(firstLink('[t][ref]', resolver), '[t][ref]', resolver)).toBe('t');
	});

	it.each([
		['[www.x.com](u)', 'www\\.x.com'],
		['[https://x.com](u)', 'https\\://x.com'],
		['[foo@bar.com](u)', 'foo\\@bar.com']
	])('%s unwraps with the re-linking trigger escaped', (display, expected) => {
		expect(buildLinkUnwrapBytes(firstLink(display), display)).toBe(expected);
	});

	it('removing an autolink is a text mutation, not an unwrap: the trigger escapes', () => {
		expect(buildLinkUnwrapBytes(firstLink('<https://x.com>'), '<https://x.com>')).toBe(
			'https\\://x.com'
		);
	});

	it('a bare autolink keeps its visible bytes and escapes in place', () => {
		expect(buildLinkUnwrapBytes(firstLink('see www.x.com now'), 'see www.x.com now')).toBe(
			'www\\.x.com'
		);
	});

	it('declines a claimed link rather than drop a rung’s syntax', () => {
		const link = { ...firstLink('[t](u)'), syntaxClaim: { prefix: '[[' } };
		expect(buildLinkUnwrapBytes(link, '[t](u)')).toBeNull();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['link-edit']);
	});
});
