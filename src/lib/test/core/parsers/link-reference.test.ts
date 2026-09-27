import { describe, it, expect } from 'vitest';
import { parseLinkReferenceDefinition } from '../../../core/parsers/link-reference';
import { splitLines } from '../../../core/lines';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';
import { parseInline } from '../../../core/inline/index';
import { metadataOf } from '../../../core/nodes';
import { describeRoundTrips } from '$lib/test/support/round-trip';

function parseOne(source: string) {
	const lines = splitLines(source);
	return parseLinkReferenceDefinition(lines, 0, lines.length, '');
}

// ── Escaped brackets in labels (CommonMark §4.7) ────────────────────────────

describe('parseLinkReferenceDefinition: escaped brackets in label', () => {
	it('parses a label containing \\]', () => {
		const result = parseOne('[foo\\]bar]: /url\n');
		expect(result).not.toBeNull();
		expect(metadataOf(result!.node, 'linkReferenceDefinition').label).toBe('foo\\]bar');
		expect(metadataOf(result!.node, 'linkReferenceDefinition').url).toBe('/url');
	});

	it('parses a label containing \\[', () => {
		const result = parseOne('[foo\\[bar]: /url\n');
		expect(result).not.toBeNull();
		expect(metadataOf(result!.node, 'linkReferenceDefinition').label).toBe('foo\\[bar');
		expect(metadataOf(result!.node, 'linkReferenceDefinition').url).toBe('/url');
	});

	it('parses a label with multiple escaped brackets', () => {
		const result = parseOne('[a\\]b\\]c]: /url\n');
		expect(result).not.toBeNull();
		expect(metadataOf(result!.node, 'linkReferenceDefinition').label).toBe('a\\]b\\]c');
	});

	it('treats \\\\ (escaped backslash) before ] as terminating the label', () => {
		// `\\` consumes both backslashes; the following `]` is unescaped and closes the label.
		const result = parseOne('[foo\\\\]: /url\n');
		expect(result).not.toBeNull();
		expect(metadataOf(result!.node, 'linkReferenceDefinition').label).toBe('foo\\\\');
	});

	it('returns null for an unterminated label (no closing bracket)', () => {
		expect(parseOne('[foo bar /url\n')).toBeNull();
	});

	it('returns null when no `]:` follows the label', () => {
		expect(parseOne('[foo] /url\n')).toBeNull();
	});
});

// ── Destination parsing ─────────────────────────────────────────────────────

describe('parseLinkReferenceDefinition: destination', () => {
	it('returns null for an unclosed angle-bracket destination', () => {
		expect(parseOne('[foo]: <bar\n')).toBeNull();
	});

	it('leaves an unclosed angle-bracket destination as a paragraph', () => {
		const doc = parse('[foo]: <bar\n');
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph']);
	});
});

// ── Trailing garbage + block-opener interruption (CommonMark §4.7) ───────────

describe('parseLinkReferenceDefinition, invalidating tails and interruptions', () => {
	it('rejects non-whitespace after the destination that is not a title', () => {
		expect(parseOne('[foo]: /url junk\n')).toBeNull();
	});

	it('rejects a title followed by non-whitespace on the same line', () => {
		expect(parseOne('[foo]: /url "title" ok\n')).toBeNull();
	});

	it('does not swallow a following block opener as a next-line destination', () => {
		// `# heading` opens an ATX heading — it must not be consumed as the url.
		expect(parseOne('[foo]:\n# heading\n')).toBeNull();
	});

	it('declines the next-line destination when the line opens a block (clean-url case)', () => {
		// `#` parses cleanly as a url (no trailing garbage), but it is an empty
		// ATX heading — the block opener wins, so this is not a definition.
		expect(parseOne('[foo]:\n#\n')).toBeNull();
	});

	it('garbage-tail definition falls through to a paragraph, registering no reference', () => {
		const doc = parse('[foo]: /url junk\n\nSee [foo] here.\n');
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph', 'paragraph']);
		const map = buildLinkReferenceMap(doc.children);
		expect(map.resolve('foo')).toBeUndefined();
	});

	it('leaves the block opener intact after a bare label line', () => {
		const doc = parse('[foo]:\n# heading\n');
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph', 'heading']);
	});

	it('still accepts a next-line fragment destination (not a block opener)', () => {
		const result = parseOne('[foo]:\n#anchor\n');
		expect(result).not.toBeNull();
		expect(metadataOf(result!.node, 'linkReferenceDefinition').url).toBe('#anchor');
	});

	it('still accepts a plain same-line and next-line definition', () => {
		expect(parseOne('[foo]: /url\n')).not.toBeNull();
		expect(parseOne('[foo]: /url "title"\n')).not.toBeNull();
		expect(parseOne('[foo]:\n/url\n')).not.toBeNull();
	});

	it('round-trips a garbage-tail line as a paragraph', () => {
		for (const source of ['[foo]: /url junk\n', '[foo]:\n# heading\n', '[foo]: /url "t" x\n']) {
			expect(serialize(parse(source))).toBe(source);
		}
	});
});

// Miss-analysis: every label case carried visible text, so §4.7's non-whitespace rule went unasked.
// Expected shapes checked against cmark-gfm via api.github.com/markdown.
describe('parseLinkReferenceDefinition: whitespace-only label', () => {
	for (const label of [' ', '\t', '   ']) {
		it(`rejects the label ${JSON.stringify(label)}`, () => {
			expect(parseOne(`[${label}]: /url\n`)).toBeNull();
		});
	}

	it('leaves a whitespace-only label as a paragraph, registering no reference', () => {
		const source = '[ ]: /url\n\nsee [ ]\n';
		const doc = parse(source);
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph', 'paragraph']);
		expect(buildLinkReferenceMap(doc.children).resolve(' ')).toBeUndefined();
		expect(serialize(doc)).toBe(source);
	});

	it('still accepts a label whose content is padded with whitespace', () => {
		expect(parseOne('[ x ]: /url\n')).not.toBeNull();
	});
});

// Miss-analysis: no next-line destination case was a setext underline, which no opener knows.
// Expected shapes checked against cmark-gfm.
describe('parseLinkReferenceDefinition: a setext underline is no next-line destination', () => {
	for (const underline of ['---', '=']) {
		it(`reads a bare label above ${JSON.stringify(underline)} as a setext heading`, () => {
			const source = `[a]:\n${underline}\n`;
			const doc = parse(source);
			expect(doc.children.map((n) => n.kind)).toEqual(['setextHeading']);
			expect(serialize(doc)).toBe(source);
		});
	}
});

describeRoundTrips('round-trip: link reference definition with escaped brackets', [
	{ name: '\\] in label', source: '[foo\\]bar]: /url\n' },
	{ name: '\\[ in label', source: '[foo\\[bar]: /url\n' },
	{
		name: 'definition + reference both with \\]',
		source: '[foo\\]bar]: /url\n\n[foo\\]bar]\n'
	}
]);

describe('reference resolution with escaped brackets in label', () => {
	it('resolves an inline shortcut reference whose label contains \\]', () => {
		const source = '[foo\\]bar]: /url\n\nSee [foo\\]bar] here.\n';
		const doc = parse(source);
		const map = buildLinkReferenceMap(doc.children);
		expect(map.resolve('foo\\]bar')).toEqual({ url: '/url' });

		const para = doc.children.find((n) => n.kind === 'paragraph');
		expect(para).toBeDefined();
		const nodes = parseInline(para!.raw, 0, para!.raw.length, map.resolve);
		const links = nodes.filter((n) => n.kind === 'link');
		expect(links).toHaveLength(1);
		expect(links[0].url).toBe('/url');
	});
});

// Miss-analysis: no definition fixture held an escape, an angle bracket or percent encoding.
describe('a definition reads its destination and title the way an inline link does (#567)', () => {
	const inlineTarget = (source: string) => {
		const [link] = parseInline(source, 0, source.length);
		return { url: link.url, title: link.title };
	};

	it('takes an escaped quote inside the title', () => {
		const result = parseOne('[foo]: /url "ti\\"tle"\n');
		expect(result).not.toBeNull();
		expect(metadataOf(result!.node, 'linkReferenceDefinition').title).toBe('ti"tle');
	});

	it('resolves an escaped destination to what the inline form resolves to', () => {
		const doc = parse('[foo]: /url\\*\n');
		expect(buildLinkReferenceMap(doc.children).resolve('foo')).toEqual(
			inlineTarget('[foo](/url\\*)')
		);
		expect(inlineTarget('[foo](/url\\*)').url).toBe('/url*');
	});

	it('refuses a `<` inside an angle-bracket destination', () => {
		expect(parseOne('[foo]: <a<b>\n')).toBeNull();
		expect(parse('[foo]: <a<b>\n').children.map((n) => n.kind)).toEqual(['paragraph']);
	});
});

// Miss-analysis: every definition title fixture fit on one line.
describe('a definition title may span lines, never a blank one', () => {
	const definitionOf = (source: string) => {
		const doc = parse(source);
		expect(serialize(doc)).toBe(source);
		return doc.children[0];
	};

	it('takes a title that continues across lines', () => {
		const node = definitionOf("[foo]: /url 'one\ntwo\n  three'\nafter\n");
		expect(node.kind).toBe('linkReferenceDefinition');
		expect(node.raw).toBe("[foo]: /url 'one\ntwo\n  three'\n");
		expect(metadataOf(node, 'linkReferenceDefinition').title).toBe('one\ntwo\nthree');
	});

	it('takes a multi-line title that starts on its own line', () => {
		const node = definitionOf('[foo]: /url\n"one\ntwo"\r\n');
		expect(node.raw).toBe('[foo]: /url\n"one\ntwo"\r\n');
		expect(metadataOf(node, 'linkReferenceDefinition').title).toBe('one\ntwo');
	});

	it('refuses a title a blank line cuts, the way the paragraph ends there', () => {
		const doc = parse("[foo]: /url 'title\n\nwith blank line'\n");
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph', 'paragraph']);
	});

	it('refuses a title a block opener cuts', () => {
		const doc = parse("[foo]: /url 'title\n# heading'\n");
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph', 'heading']);
	});

	it('keeps the definition without its title when an own-line title never closes', () => {
		const doc = parse('[foo]: /url\n"one\ntwo\n');
		expect(doc.children.map((n) => n.kind)).toEqual(['linkReferenceDefinition', 'paragraph']);
		expect(metadataOf(doc.children[0], 'linkReferenceDefinition').title).toBeUndefined();
	});
});

describe("the whitespace between a definition's parts", () => {
	// §4.7 allows spaces or tabs; commonmark.js takes only spaces, so this pin is by hand.
	it('takes tabs as well as spaces', () => {
		const meta = metadataOf(parseOne('[foo]:\t/url\t"t"\n')!.node, 'linkReferenceDefinition');
		expect(meta).toEqual({ label: 'foo', url: '/url', title: 't' });
	});

	// Miss-analysis: every definition fixture ended in `\n`, never a lone `\r`.
	it('ends a last line that carries a lone carriage return', () => {
		const source = '[foo]: /url\r';
		expect(parse(source).children.map((n) => n.kind)).toEqual(['linkReferenceDefinition']);
		expect(serialize(parse(source))).toBe(source);
	});
});

// Miss-analysis: every label fixture was short, on one line and free of a bare `[`.
describe('a definition reads its label the way a reference link does', () => {
	it('refuses an unescaped `[` inside the label', () => {
		expect(parseOne('[a[b]: /u\n')).toBeNull();
		expect(parse('[a[b]: /u\n').children.map((n) => n.kind)).toEqual(['paragraph']);
	});

	it('takes 999 label characters and refuses 1000', () => {
		expect(parseOne(`[${'a'.repeat(999)}]: /u\n`)).not.toBeNull();
		expect(parseOne(`[${'a'.repeat(1000)}]: /u\n`)).toBeNull();
	});

	it('takes a label that spans lines, keyed the way a reference to it normalizes', () => {
		const source = '[\nfoo\n]: /url\nbar\n';
		const doc = parse(source);
		expect(doc.children.map((n) => n.kind)).toEqual(['linkReferenceDefinition', 'paragraph']);
		expect(doc.children[0].raw).toBe('[\nfoo\n]: /url\n');
		expect(serialize(doc)).toBe(source);
		expect(buildLinkReferenceMap(doc.children).resolve('foo')).toEqual({ url: '/url' });
	});

	it('matches a label split across indented lines to its one-line reference', () => {
		const doc = parse('[Foo\n   BAR]: /url\n');
		expect(buildLinkReferenceMap(doc.children).resolve('foo bar')).toEqual({ url: '/url' });
	});
});
