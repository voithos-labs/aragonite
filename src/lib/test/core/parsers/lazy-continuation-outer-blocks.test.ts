// Miss-analysis (#135): the blockquote and list lazy suites only pinned lines the
// paragraph-interrupt registry already rejects, so the wider rule — any outer block start ends
// laziness, the §4.4 interrupt exceptions not applying — had no case at all. Expected shapes
// verified against cmark-gfm via api.github.com/markdown.
import { describe, it, expect } from 'vitest';
import { parse } from '../../../core/parser';
import { serialize } from '../../../core/serializer';

function topKinds(source: string): string[] {
	const doc = parse(source);
	expect(serialize(doc)).toBe(source);
	return doc.children.map((c) => String(c.kind));
}

describe('lazy continuation ends at a line that starts an outer block', () => {
	const enders: [name: string, source: string, kinds: string[]][] = [
		['quote, break shaped as a setext underline', '> foo\n---\n', ['blockquote', 'thematicBreak']],
		['quote, ordered marker not starting at 1', '> one\n2. x\n', ['blockquote', 'list']],
		['quote, type-7 HTML', '> one\n<x-foo>\n', ['blockquote', 'htmlBlock']],
		['item, break shaped as a setext underline', '- one\n---\n', ['list', 'thematicBreak']],
		['item, type-7 HTML', '- one\n<x-foo>\n', ['list', 'htmlBlock']]
	];

	for (const [name, source, kinds] of enders) {
		it(`ends the ${name}`, () => {
			expect(topKinds(source)).toEqual(kinds);
		});
	}
});

describe('lazy continuation survives the two starts an open paragraph absorbs', () => {
	// An indented line cannot open code while a paragraph is open to absorb it (§4.4), and a
	// link reference definition is carved out of a paragraph at finalize, never opened.
	const stayLazy: [name: string, source: string, kind: string][] = [
		['quote, indented line', '> foo\n    bar\n', 'blockquote'],
		['quote, link reference definition', '> foo\n[a]: /u\n', 'blockquote'],
		['item, indented line', '- one\n    bar\n', 'list'],
		['item, link reference definition', '- one\n[a]: /u\n', 'list']
	];

	for (const [name, source, kind] of stayLazy) {
		it(`keeps the ${name} lazy`, () => {
			expect(topKinds(source)).toEqual([kind]);
		});
	}
});
