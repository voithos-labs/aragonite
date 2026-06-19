import { describe, it, expect } from 'vitest';
import { parseLinkReferenceDefinition } from '../../../core/parsers/link-reference';
import { splitLines } from '../../../core/lines';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';
import { buildLinkReferenceMap } from '../../../core/inline/link-reference-resolver';
import { parseInline } from '../../../core/inline/index';
import { metadataOf } from '../../../core/nodes';

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

describe('round-trip: link reference definition with escaped brackets', () => {
	const cases = [
		{ name: '\\] in label', source: '[foo\\]bar]: /url\n' },
		{ name: '\\[ in label', source: '[foo\\[bar]: /url\n' },
		{
			name: 'definition + reference both with \\]',
			source: '[foo\\]bar]: /url\n\n[foo\\]bar]\n'
		}
	];
	for (const { name, source } of cases) {
		it(`round-trips: ${name}`, () => {
			const doc = parse(source);
			expect(serialize(doc)).toBe(source);
		});
	}
});

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
