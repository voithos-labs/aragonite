import { describe, it, expect } from 'vitest';
import { parseLinkReferenceDefinition } from '../../../core/parsers/link-reference';
import { splitLines } from '../../../core/lines';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';
import { parseInline } from '../../../core/inline/index';
import { metadataOf } from '../../../core/nodes';
import { describeRoundTrips } from '$lib/test/support/round-trip';

// ── Escaped brackets in labels (CommonMark §4.7) ────────────────────────────

describe('parseLinkReferenceDefinition — escaped brackets in label', () => {
	function parseOne(source: string) {
		const lines = splitLines(source);
		return parseLinkReferenceDefinition(lines, 0, lines.length, '');
	}

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

describe('parseLinkReferenceDefinition — destination', () => {
	function parseOne(source: string) {
		const lines = splitLines(source);
		return parseLinkReferenceDefinition(lines, 0, lines.length, '');
	}

	it('returns null for an unclosed angle-bracket destination', () => {
		expect(parseOne('[foo]: <bar\n')).toBeNull();
	});

	it('leaves an unclosed angle-bracket destination as a paragraph', () => {
		const doc = parse('[foo]: <bar\n');
		expect(doc.children.map((n) => n.kind)).toEqual(['paragraph']);
	});
});

// ── Trailing garbage + block-opener interruption (CommonMark §4.7) ───────────

describe('parseLinkReferenceDefinition — invalidating tails and interruptions', () => {
	function parseOne(source: string) {
		const lines = splitLines(source);
		return parseLinkReferenceDefinition(lines, 0, lines.length, '');
	}

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
