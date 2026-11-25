// Miss-analysis: no suite compared the definition's extent with cmark-gfm's lazy reading (GH #24).
// Shapes checked live against api.github.com/markdown.
import { beforeEach, describe, expect, it } from 'vitest';
import { parse as parseWith, serialize } from '#lib';
import { DEFINITION, footnotesGrammar } from '#lib/test/support/footnotes-grammar.js';

const NBSP = String.fromCharCode(0xa0);

let grammar: ReturnType<typeof footnotesGrammar>;
const parse = (source: string) => parseWith(source, { grammar });

beforeEach(() => {
	grammar = footnotesGrammar();
});

function parseKinds(src: string): string[] {
	const doc = parse(src);
	expect(serialize(doc)).toBe(src);
	return doc.children.map((c) => String(c.kind));
}

describe('footnote definition lazy continuation (absorbed lines)', () => {
	it('keeps an unindented non-blank line in the open body paragraph', () => {
		const doc = parse('[^a]: one\nlazy\n');
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(doc.children[0].children?.[0].raw).toBe('one\nlazy\n');
		expect(serialize(doc)).toBe('[^a]: one\nlazy\n');
	});

	it('absorbs the pasteable nbsp-line repro into one definition (#24)', () => {
		const src = `[^a]: one\n${NBSP}\n    two\n`;
		const doc = parse(src);
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(doc.children[0].children?.[0].raw).toBe(`one\n${NBSP}\ntwo\n`);
		expect(serialize(doc)).toBe(src);
	});

	// The marker-strip pattern wants four literal columns; a tab-expanded indent reaches the
	// scan as a lazy line instead, and an indented line cannot end laziness (§4.4).
	it('absorbs a tab-expanded indent the marker strip does not claim', () => {
		const src = '[^a]: one\n  \tbar\n';
		const doc = parse(src);
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(serialize(doc)).toBe(src);
	});

	it('continues lazily after an indented continuation line', () => {
		const doc = parse('[^a]: one\n    two\nlazy\n');
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(doc.children[0].children?.[0].raw).toBe('one\ntwo\nlazy\n');
	});

	it('rides CRLF endings through a lazy line', () => {
		const doc = parse('[^a]: one\r\nlazy\r\n');
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(serialize(doc)).toBe('[^a]: one\r\nlazy\r\n');
	});

	// GitHub keeps both as paragraph text; here the absorbed `===` reparses as a setext heading,
	// the same body reading the core blockquote model uses.
	it('absorbs setext-underline and link-reference-definition shaped lines', () => {
		expect(parseKinds('[^a]: one\n===\n')).toEqual([DEFINITION]);
		const lrd = parse('[^a]: one\n[x]: /url\n');
		expect(lrd.children.map((c) => c.kind)).toEqual([DEFINITION]);
		expect(lrd.children[0].children?.[0].kind).toBe('paragraph');
	});
});

describe('footnote definition lazy continuation (lines that end it)', () => {
	// cmark-gfm ends laziness on any block start at the outer level, so the ordered-2 list
	// and type-7 HTML paragraph-interrupt exceptions do not apply here.
	const enders: [string, string, string][] = [
		['a sibling definition', '[^b]: two\n', DEFINITION],
		['a thematic break, never a setext underline', '---\n', 'thematicBreak'],
		['a bullet list line', '- item\n', 'list'],
		['an ordered list line not starting at 1', '2. x\n', 'list'],
		['an ATX heading', '# h\n', 'heading'],
		['a blockquote line', '> q\n', 'blockquote'],
		['a type-7 HTML line', '<x-foo>\n', 'htmlBlock']
	];

	for (const [name, line, siblingKind] of enders) {
		it(`ends the definition at ${name}`, () => {
			expect(parseKinds(`[^a]: one\n${line}`)).toEqual([DEFINITION, siblingKind]);
		});
	}

	it('does not resume lazily once a blank line closed the paragraph', () => {
		const doc = parse('[^a]: one\n\nlazy\n');
		expect(doc.children.map((c) => c.kind)).toEqual([DEFINITION, 'paragraph']);
		expect(doc.children[0].raw).toBe('[^a]: one\n');
	});

	// GitHub reads the lazy line into the nested item's paragraph, but the scan tracks the open
	// paragraph per line, as the core blockquote and list models do, so the definition ends.
	it('ends after an indented line that opens a block in the body', () => {
		expect(parseKinds('[^a]: one\n    - x\nlazy\n')).toEqual([DEFINITION, 'paragraph']);
	});
});
