// Miss: round-trip.test.ts pinned only indented continuations — no suite compared the
// definition's extent against cmark-gfm's lazy-continuation reading (#24), so the scan's
// missing paragraph state was invisible. Expected shapes verified live via api.github.com/markdown.
import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';

const NBSP = String.fromCharCode(0xa0);

function parseKinds(src: string): string[] {
	const doc = parse(src);
	expect(serialize(doc)).toBe(src);
	return doc.children.map((c) => String(c.kind));
}

describe('footnote definition lazy continuation (absorbed lines)', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('keeps an unindented non-blank line in the open body paragraph', () => {
		const doc = parse('[^a]: one\nlazy\n');
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND]);
		expect(doc.children[0].children?.[0].raw).toBe('one\nlazy\n');
		expect(serialize(doc)).toBe('[^a]: one\nlazy\n');
	});

	it('absorbs the pasteable nbsp-line repro into one definition (#24)', () => {
		const src = `[^a]: one\n${NBSP}\n    two\n`;
		const doc = parse(src);
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND]);
		expect(doc.children[0].children?.[0].raw).toBe(`one\n${NBSP}\ntwo\n`);
		expect(serialize(doc)).toBe(src);
	});

	// The marker-strip pattern wants four literal columns; a tab-expanded indent reaches the
	// scan as a lazy line instead, and an indented line cannot end laziness (§4.4).
	it('absorbs a tab-expanded indent the marker strip does not claim', () => {
		const src = '[^a]: one\n  \tbar\n';
		const doc = parse(src);
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND]);
		expect(serialize(doc)).toBe(src);
	});

	it('continues lazily after an indented continuation line', () => {
		const doc = parse('[^a]: one\n    two\nlazy\n');
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND]);
		expect(doc.children[0].children?.[0].raw).toBe('one\ntwo\nlazy\n');
	});

	it('rides CRLF endings through a lazy line', () => {
		const doc = parse('[^a]: one\r\nlazy\r\n');
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND]);
		expect(serialize(doc)).toBe('[^a]: one\r\nlazy\r\n');
	});

	// GitHub keeps both as literal paragraph text: a setext underline cannot be lazy, and a
	// link reference definition is not a block start in cmark. The absorbed `===` reparses
	// as a setext heading here — the body reading shared with the core blockquote model.
	it('absorbs setext-underline and link-reference-definition shaped lines', () => {
		expect(parseKinds('[^a]: one\n===\n')).toEqual([FOOTNOTE_DEF_KIND]);
		const lrd = parse('[^a]: one\n[x]: /url\n');
		expect(lrd.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND]);
		expect(lrd.children[0].children?.[0].kind).toBe('paragraph');
	});
});

describe('footnote definition lazy continuation (lines that end it)', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	// cmark-gfm ends laziness on any block start at the outer level, so the ordered-2 list
	// and type-7 HTML paragraph-interrupt exceptions do not apply here.
	const enders: [string, string, string][] = [
		['a sibling definition', '[^b]: two\n', FOOTNOTE_DEF_KIND],
		['a thematic break, never a setext underline', '---\n', 'thematicBreak'],
		['a bullet list line', '- item\n', 'list'],
		['an ordered list line not starting at 1', '2. x\n', 'list'],
		['an ATX heading', '# h\n', 'heading'],
		['a blockquote line', '> q\n', 'blockquote'],
		['a type-7 HTML line', '<x-foo>\n', 'htmlBlock']
	];

	for (const [name, line, siblingKind] of enders) {
		it(`ends the definition at ${name}`, () => {
			expect(parseKinds(`[^a]: one\n${line}`)).toEqual([FOOTNOTE_DEF_KIND, siblingKind]);
		});
	}

	it('does not resume lazily once a blank line closed the paragraph', () => {
		const doc = parse('[^a]: one\n\nlazy\n');
		expect(doc.children.map((c) => c.kind)).toEqual([FOOTNOTE_DEF_KIND, 'paragraph']);
		expect(doc.children[0].raw).toBe('[^a]: one\n');
	});

	// GitHub reads the lazy line into the nested item's paragraph; this scan approximates
	// the open paragraph per line (as the core blockquote/list models do), so laziness
	// reaches only the body's own top-level paragraph and the definition ends instead.
	it('ends after an indented line that opens a block in the body', () => {
		expect(parseKinds('[^a]: one\n    - x\nlazy\n')).toEqual([FOOTNOTE_DEF_KIND, 'paragraph']);
	});
});
