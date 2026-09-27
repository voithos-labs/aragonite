import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import { scanInline } from '$lib/core/inline/scan';
import { normalizeLinkLabel } from '$lib/core/inline/link-reference-resolver';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { roundTripCases } from '$lib/test/support/round-trip';
import { editorOutline, referenceOutline } from './block-outline';

/**
 * Every grammar rule reads GFM's whitespace (§2.1: space, tab and the ASCII line characters),
 * never JS `\s`, so a non-breaking space where a rule wants a space or tab is content. Shapes
 * commonmark.js gets right are pinned against it; the rest by hand, each with its clause.
 */

const NBSP = String.fromCharCode(0xa0);

const REFERENCE_SHAPES: { rule: string; source: string }[] = [
	{ rule: 'thematic break, trailing (§4.1)', source: `***${NBSP}\n` },
	{ rule: 'thematic break, leading (§4.1)', source: `${NBSP}***\n` },
	{ rule: 'setext underline (§4.3)', source: `a\n===${NBSP}\n` },
	{ rule: 'bullet marker (§5.2)', source: `-${NBSP}a\n` },
	{ rule: 'bullet marker before a star run (§5.2)', source: `*${NBSP}**\n` },
	{ rule: 'an item interrupting a paragraph (§5.2)', source: `a\n- ${NBSP}\n` },
	{ rule: 'ATX heading (§4.2)', source: `#${NBSP}foo\n` },
	{ rule: 'closing code fence (§4.5)', source: '```\ncode\n```' + NBSP + '\nafter\n' },
	{ rule: 'link destination (§6.6)', source: `[a]: /u${NBSP}x\n\n[a]\n` }
];

const HAND_PINNED_SOURCES: { rule: string; source: string }[] = [
	{ rule: 'info string', source: '```' + NBSP + 'js\nx\n```\n' },
	{ rule: 'link label', source: `[${NBSP}]: /u\n` },
	{ rule: 'html block start', source: `<div${NBSP}>\n` },
	{ rule: 'table delimiter row', source: `| a | b |\n| --- | ---${NBSP}|\n` },
	{ rule: 'table cell', source: `| ${NBSP}a | b |\n| --- | --- |\n` }
];

const first = (source: string) => parse(source).children[0];

function autolinkUrls(raw: string): string[] {
	return scanInline(raw, 0, raw.length, undefined, defaultGrammarView)
		.filter((node) => node.kind === 'autolink')
		.map((node) => node.url ?? '');
}

describe('a non-breaking space is content to every block rule commonmark.js follows', () => {
	it.each(REFERENCE_SHAPES.map((s): [string, string] => [s.rule, s.source]))(
		'%s',
		(_rule, source) => {
			expect(editorOutline(source)).toEqual(referenceOutline(source));
		}
	);

	it('keeps the non-breaking space inside the link destination, percent-encoded', () => {
		expect(first(`[a]: /u${NBSP}x\n`).metadata).toMatchObject({ url: '/u%C2%A0x' });
	});
});

// commonmark.js `String.trim()`s the info string and the label, and has no GFM extensions, so
// these follow cmark-gfm and the spec text instead.
describe('a non-breaking space is content where commonmark.js is no reference', () => {
	it('stays in the info string (§4.5 trims whitespace, which §2.1 makes ASCII)', () => {
		expect(first('```' + NBSP + 'js\nx\n```\n').metadata).toMatchObject({ info: `${NBSP}js` });
	});

	it('fills a link label (§6.6: at least one non-whitespace character)', () => {
		expect(first(`[${NBSP}]: /u\n`).kind).toBe('linkReferenceDefinition');
	});

	it('is not collapsed when labels are matched (§6.6 collapses whitespace only)', () => {
		expect(normalizeLinkLabel(` A \n\t b `)).toBe('a b');
		expect(normalizeLinkLabel(`a${NBSP}b`)).not.toBe(normalizeLinkLabel('a b'));
	});

	it('does not end an html block tag name (§4.6 start condition 6)', () => {
		expect(editorOutline(`<div${NBSP}>\n`)).toEqual(['paragraph']);
	});

	it('breaks a table delimiter row (§4.10: cells hold dashes, colons, spaces)', () => {
		expect(editorOutline(`| a | b |\n| --- | ---${NBSP}|\n`)).toEqual(['paragraph']);
	});

	it('survives a table cell trim (§4.10 trims spaces)', () => {
		const table = first(`| ${NBSP}a | b |\n| --- | --- |\n`);
		expect(table.children?.[0].children?.map((cell) => cell.raw)).toEqual([`${NBSP}a`, 'b']);
	});

	it('is no autolink boundary before a bare link (§6.9: after whitespace)', () => {
		expect(autolinkUrls(`x${NBSP}www.example.com`)).toEqual([]);
		expect(autolinkUrls('x www.example.com')).toEqual(['http://www.example.com']);
	});

	it('does not end a bare link (§6.9: until whitespace or `<`)', () => {
		expect(autolinkUrls(`www.example.com/a${NBSP}b c`)).toEqual([
			`http://www.example.com/a${NBSP}b`
		]);
		expect(autolinkUrls(`https://example.com/a${NBSP}b`)).toEqual([
			`https://example.com/a${NBSP}b`
		]);
	});
});

// A document's last line can end in a lone `\r`, which the line splitter leaves in the line's
// text. Each rule that allows trailing spaces or tabs has to allow the ending after them too.
const LONE_CR_SHAPES: { rule: string; source: string }[] = [
	{ rule: 'thematic break', source: 'a\n\n***\r' },
	{ rule: 'thematic break after spaces', source: 'a\n\n- - - \r' },
	{ rule: 'bare ATX heading', source: 'a\n\n##\r' },
	{ rule: 'setext underline', source: 'a\n===\r' },
	{ rule: 'setext underline after spaces', source: 'a\n---  \r' },
	{ rule: 'a content-less item under a paragraph', source: 'a\n- \r' }
];

describe('a lone carriage return ends the last line for every trailing-space rule', () => {
	it.each(LONE_CR_SHAPES.map((s): [string, string] => [s.rule, s.source]))(
		'%s',
		(_rule, source) => {
			expect(editorOutline(source)).toEqual(referenceOutline(source));
		}
	);
});

describe('whitespace-class shapes round-trip byte-for-byte', () => {
	roundTripCases(
		[...REFERENCE_SHAPES, ...HAND_PINNED_SOURCES, ...LONE_CR_SHAPES].map(({ rule, source }) => ({
			name: rule,
			source
		}))
	);
});
