// @vitest-environment jsdom
// The link card's text field: the bytes a new text writes, and when the field is read-only.
// Miss-analysis: #807, the card wrote destinations only, so its write path had no text case.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { parseInline } from '#lib/core/inline/index.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';
import type { InlineNode } from '#lib/core/nodes.js';
import {
	buildLinkRetitleBytes,
	buildLinkWrapBytes,
	linkTextShown
} from '#lib/core/inline/link-source-bytes.js';
import { fixtureReading } from '../../harness/fixture-grammar';

const DEF = '[foo]: https://foo.example';

function readingFor(display: string) {
	const { resolve, signature } = definitionsOf(parse(`${display}\n\n${DEF}\n`).children);
	return fixtureReading({ resolver: resolve, resolverSignature: signature }, 'live');
}

function linkIn(display: string): InlineNode {
	const reading = readingFor(display);
	const all = (nodes: InlineNode[]): InlineNode[] =>
		nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
	const link = all(parseInline(display, 0, display.length, reading.resolver)).find(
		(n) => n.kind === 'link'
	);
	if (!link) throw new Error(`no link in ${display}`);
	return link;
}

function retitle(display: string, text: string, url?: string): string | null {
	const link = linkIn(display);
	return buildLinkRetitleBytes(link, display, text, url ?? link.url ?? '', readingFor(display));
}

describe('a link given a new text', () => {
	it.each([
		['an inline link', 'a [old](https://x.example) b', 'new text', '[new text](https://x.example)'],
		['one with a title', 'a [old](u "t") b', 'new', '[new](u "t")'],
		['a full reference, keeping its label', 'a [old][foo] b', 'new', '[new][foo]'],
		['a collapsed reference, spelled in full', 'a [foo][] b', 'new', '[new][foo]'],
		['a shortcut reference, spelled in full', 'a [foo] b', 'new', '[new][foo]'],
		[
			'text that would end the link early',
			'a [old](u) b',
			'x]y(z)|w\\',
			'[x\\]y\\(z\\)\\|w\\\\](u)'
		],
		['text that would format itself', 'a [old](u) b', '*a* `b`', '[\\*a\\* \\`b\\`](u)']
	])('%s', (_, display, text, bytes) => {
		expect(retitle(display, text)).toBe(bytes);
	});

	it('writes the inline form when the url changes with it', () => {
		expect(retitle('a [foo] b', 'new', 'https://y.example')).toBe('[new](https://y.example)');
	});

	it('refuses an empty text', () => {
		expect(retitle('a [old](u) b', '')).toBeNull();
	});
});

describe('the text the field shows', () => {
	it('is the visible text of a plain link, escapes resolved', () => {
		const display = 'a [x\\]y &amp; z](u) b';
		expect(linkTextShown(linkIn(display), display, fixtureReading())).toEqual({
			text: 'x]y & z',
			editable: true
		});
	});

	it.each([
		['bold', 'a [**b** c](u)'],
		['code', 'a [`c`](u)']
	])('is read-only when the text holds %s, which an edit would break', (_, display) => {
		expect(linkTextShown(linkIn(display), display, fixtureReading()).editable).toBe(false);
	});
});

describe('a link created over a selection with its own text', () => {
	it('writes the field’s text over the range', () => {
		expect(buildLinkWrapBytes('see here now', 4, 8, 'u', 'there', fixtureReading())).toBe(
			'[there](u)'
		);
	});

	// The `!` before the range would make the new text an image's alt, which is no link at all.
	it('refuses a text that would not read as a link there', () => {
		expect(buildLinkWrapBytes('a !bravo c', 3, 8, 'u', 'x', fixtureReading())).toBeNull();
	});

	it('refuses an empty text or url', () => {
		expect(buildLinkWrapBytes('see here now', 4, 8, 'u', '', fixtureReading())).toBeNull();
		expect(buildLinkWrapBytes('see here now', 4, 8, ' ', 'x', fixtureReading())).toBeNull();
	});
});
